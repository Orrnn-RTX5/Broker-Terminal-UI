import { useUiTranslation } from '../hooks/useUiTranslation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { drawingManager } from '../services/drawingManager';
import type { Drawing } from './model/drawing';
import { ANNOTATION_TOOLS, annotationTable, isAnnotationImage, isAnnotationLink } from './annotationToolCatalog';
import './AnnotationEditor.css';
import { commandBus } from '../services/commandBus';

export interface AnnotationEditDetail {
  drawing: Drawing;
  contextId: string;
  x: number;
  y: number;
  isNew?: boolean;
}

export function AnnotationEditor() {
    const tr = useUiTranslation();
  const [edit, setEdit] = useState<AnnotationEditDetail | null>(null);
  const [text, setText] = useState('');
  const [style, setStyle] = useState<Drawing['annotation']>({});
  const [color, setColor] = useState('#2962ff');
  const [background, setBackground] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<AnnotationEditDetail | null>(null);
  const fileRequest = useRef(0);
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<AnnotationEditDetail>).detail;
      if (detail.drawing.locked) return;
      const previous = editRef.current;
      if (previous?.isNew && previous.drawing.id !== detail.drawing.id) drawingManager.deleteDrawing(previous.drawing.id, previous.contextId);
      setEdit(detail);
      setExpanded(false);
      editRef.current = detail;
      fileRequest.current += 1;
      setError('');
      setStyle(detail.drawing.annotation ?? {});
      setColor(detail.drawing.color || '#2962ff');
      setBackground(detail.drawing.fillColor || '');
      const tool = ANNOTATION_TOOLS.find(item => item.id === (detail.drawing.subtype || 'text'));
      setText(detail.isNew && detail.drawing.text === tool?.label ? '' : detail.drawing.text ?? '');
    };
    const close = () => {
      const current = editRef.current;
      editRef.current = null; fileRequest.current += 1;
      if (current?.isNew) drawingManager.deleteDrawing(current.drawing.id, current.contextId);
      setEdit(null);
    };
    window.addEventListener('drawing:edit-annotation', open);
    window.addEventListener('chartSymbolChanged', close);
    const unsubscribeTool = commandBus.subscribe('SELECT_TOOL', close);
    return () => {
      window.removeEventListener('drawing:edit-annotation', open);
      window.removeEventListener('chartSymbolChanged', close);
      unsubscribeTool();
    };
  }, []);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !edit) return;
    const place = () => { const rect = dialog.getBoundingClientRect();
      dialog.style.left = `${Math.max(8, Math.min(edit.x, window.innerWidth - rect.width - 8))}px`;
      dialog.style.top = `${Math.max(8, Math.min(edit.y, window.innerHeight - rect.height - 8))}px`;
    };
    place(); window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [edit, style?.tableData?.length, style?.imageUrl, error, expanded]);
  if (!edit) return null;
  const isTable = edit.drawing.subtype === 'table';
  const isImage = edit.drawing.subtype === 'image';
  const isLink = ['post', 'idea'].includes(edit.drawing.subtype ?? '');
  const isIdea = edit.drawing.subtype === 'idea';
  const loadImage = (file?: File) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setError('Choose a JPG, PNG or WEBP image up to 2 MB.'); return;
    }
    const reader = new FileReader();
    const request = ++fileRequest.current;
    reader.onload = () => {
      if (request !== fileRequest.current || !editRef.current) return;
      const image = new Image();
      image.onload = () => { if (request !== fileRequest.current || !editRef.current) return;
        setStyle(current => ({ ...current, imageUrl: String(reader.result), width: Math.min(400, image.width), height: Math.min(400, image.width) * image.height / image.width })); setError(''); };
      image.onerror = () => setError('This image could not be opened.');
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };
  const cells = annotationTable(style?.tableData);
  const cancel = () => {
    if (edit.isNew) drawingManager.deleteDrawing(edit.drawing.id, edit.contextId);
    editRef.current = null; fileRequest.current += 1; setEdit(null);
  };
  const resizeTable = (rows: number, columns: number) => setStyle({ ...style, tableData: Array.from({ length: Math.max(1, Math.min(10, rows)) }, (_, row) =>
    Array.from({ length: Math.max(1, Math.min(10, columns)) }, (_, col) => cells[row]?.[col] ?? '')) });
  const save = () => {
    if (isImage && !isAnnotationImage(style?.imageUrl ?? '')) { setError('Choose an image or enter a valid image URL.'); return; }
    if (isLink && !isAnnotationLink(style?.url ?? '', edit.drawing.subtype!)) { setError(isIdea ? 'Enter a published TradingView idea link.' : 'Enter a valid link to an X post.'); return; }
    if (drawingManager.getDrawings(edit.contextId).find(drawing => drawing.id === edit.drawing.id)?.locked) { setEdit(null); return; }
    drawingManager.updateDrawingProperties(edit.drawing.id, { text: text.trim(), annotation: style, color, fillColor: background }, edit.contextId);
    editRef.current = null; fileRequest.current += 1;
    setEdit(null);
  };
  if (edit.isNew && (edit.drawing.subtype || 'text') === 'text' && !expanded) {
    const fontSize = style?.fontSize ?? 14;
    return createPortal(<div ref={dialogRef} role="dialog" aria-label={tr("Edit annotation")} className="annotation-editor annotation-editor--inline"
      onPointerDown={event => event.stopPropagation()} onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { if (text.trim()) save(); else cancel(); }
      }} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') cancel(); if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) save(); }}>
      <div className="annotation-editor__inline-tools">
        <select aria-label={tr("Font size")} value={fontSize} onChange={event => setStyle({ ...style, fontSize: Number(event.target.value) })}>
          {[10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64].map(size => <option key={size} value={size}>{size}</option>)}
        </select>
        <input type="color" aria-label={tr("Text color")} value={style?.textColor || color} onChange={event => setStyle({ ...style, textColor: event.target.value })} />
        <button type="button" aria-label={tr("Text settings")} onClick={() => setExpanded(true)}>{tr("Settings")}</button>
      </div>
      <textarea autoFocus aria-label={tr("Annotation text")} placeholder={tr("Add text")} value={text} onChange={event => setText(event.target.value)}
        rows={Math.min(8, Math.max(1, text.split('\n').length))} style={{ display: 'block', width: '100%', resize: 'none', padding: '2px 4px', fontFamily: 'Arial, sans-serif',
          fontSize, lineHeight: 1.25, fontWeight: style?.bold ? 700 : 400, fontStyle: style?.italic ? 'italic' : 'normal', color: style?.textColor || color }} />
      <div className="annotation-editor__inline-actions"><button type="button" onClick={cancel}>{tr("Cancel")}</button><button type="button" onClick={save}>{tr("OK")}</button></div>
    </div>, document.body);
  }
  return createPortal(<div ref={dialogRef} className="annotation-editor" role="dialog" aria-label={tr("Edit annotation")}
    onPointerDown={e => e.stopPropagation()} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') cancel(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); }}>
    <div style={{ marginBottom: 8 }}>{ANNOTATION_TOOLS.find(item => item.id === (edit.drawing.subtype || 'text'))?.label ?? 'Text'}</div>
    {!isImage && !isLink && <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
      <input type="color" aria-label={tr("Drawing color")} title={tr("Drawing color")} value={color} onChange={e => setColor(e.target.value)} style={{ width: 28 }} />
      <input type="color" aria-label={tr("Text color")} title={tr("Text color")} value={style?.textColor || (['price_note', 'price_label', 'callout', 'comment'].includes(edit.drawing.subtype ?? '') ? '#ffffff' : color)} onChange={e => setStyle({ ...style, textColor: e.target.value })} style={{ width: 28 }} />
      <select aria-label={tr("Font size")} value={style?.fontSize ?? 14} onChange={e => setStyle({ ...style, fontSize: Number(e.target.value) })}>
        {[10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64].map(size => <option key={size} value={size}>{size}</option>)}
      </select>
      <button type="button" aria-label={tr("Bold")} aria-pressed={style?.bold ?? false} onClick={() => setStyle({ ...style, bold: !style?.bold })}><b>B</b></button>
      <button type="button" aria-label={tr("Italic")} aria-pressed={style?.italic ?? false} onClick={() => setStyle({ ...style, italic: !style?.italic })}><i>I</i></button>
    </div>}
    {isLink ? <>
      <label>{isIdea ? tr("Idea link") : tr("Post link")} <input autoFocus aria-label={isIdea ? tr("Idea link") : tr("Post link")} placeholder={isIdea ? tr("Insert a link to the idea") : tr("Insert a link to the X post")} value={style?.url ?? ''} onChange={e => { setStyle({ ...style, url: e.target.value }); setError(''); }} style={{ width: '100%' }} /></label>
      <label>{tr("Caption ")}<textarea aria-label={tr("Caption")} value={text} onChange={e => setText(e.target.value)} rows={3} style={{ width: '100%' }} /></label>
      {error && <p role="alert">{error}</p>}
    </> : isImage ? <>
      <label>{tr("Choose image ")}<input aria-label={tr("Choose image")} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => loadImage(e.target.files?.[0])} /></label>
      <p>{tr("JPG, PNG or WEBP · Up to 2 MB")}</p>
      <label>{tr("Image URL ")}<input aria-label={tr("Image URL")} type="url" value={style?.imageUrl?.startsWith('data:') ? '' : style?.imageUrl ?? ''} onChange={e => setStyle({ ...style, imageUrl: e.target.value })} /></label>
      {style?.imageUrl && <img src={style.imageUrl} alt="Annotation preview" style={{ maxWidth: '100%', maxHeight: 100 }} />}
      <div><label>{tr("Width ")}<input aria-label={tr("Image width")} type="number" min="24" max="1200" value={style?.width ?? 240} onChange={e => setStyle({ ...style, width: Number(e.target.value) })} style={{ width: 65 }} /></label>
      <label>{tr("Height ")}<input aria-label={tr("Image height")} type="number" min="24" max="1200" value={style?.height ?? 160} onChange={e => setStyle({ ...style, height: Number(e.target.value) })} style={{ width: 65 }} /></label></div>
      <label>{tr("Transparency ")}<input aria-label={tr("Transparency")} type="range" min="0" max="100" value={100 - (style?.opacity ?? 1) * 100} onChange={e => setStyle({ ...style, opacity: 1 - Number(e.target.value) / 100 })} /></label>
      {error && <p role="alert">{error}</p>}
    </> : isTable ? <>
      <div style={{ display: 'flex', gap: 10 }}>
        <label>{tr("Rows ")}<input aria-label={tr("Table rows")} type="number" min="1" max="10" value={cells.length} onChange={e => resizeTable(Number(e.target.value), cells[0].length)} style={{ width: 45 }} /></label>
        <label>{tr("Columns ")}<input aria-label={tr("Table columns")} type="number" min="1" max="10" value={cells[0].length} onChange={e => resizeTable(cells.length, Number(e.target.value))} style={{ width: 45 }} /></label>
      </div>
      <div style={{ overflow: 'auto', maxHeight: 240, margin: '8px 0' }}><table style={{ borderCollapse: 'collapse' }}><tbody>
        {cells.map((row, r) => <tr key={r}>{row.map((value, c) => <td key={c}><input aria-label={tr("Row {{value0}} column {{value1}}", { value0: r + 1, value1: c + 1 })} value={value}
          onChange={e => setStyle({ ...style, tableData: cells.map((line, i) => line.map((cell, j) => i === r && j === c ? e.target.value : cell)) })}
          style={{ width: 76, padding: 5, border: '1px solid var(--border-primary)', color: 'var(--text-primary)', background: 'var(--bg-primary)' }} /></td>)}</tr>)}
      </tbody></table></div>
      <label>{tr("Cell width ")}<input aria-label={tr("Cell width")} type="number" min="40" max="300" value={style?.cellWidth ?? 120} onChange={e => setStyle({ ...style, cellWidth: Number(e.target.value) })} style={{ width: 65 }} /></label>
    </> : <textarea autoFocus aria-label={tr("Annotation text")} placeholder={tr("Add text")} value={text} rows={5}
      onChange={e => setText(e.target.value)}
      style={{ width: '100%', resize: 'vertical', padding: 6, background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }} />}
    {!isImage && !isLink && <>
    {!isTable && <label>{tr("Text wrap ")}<input aria-label={tr("Text wrap width")} type="number" min="0" max="800" step="20" value={style?.wrapWidth ?? 0} onChange={e => setStyle({ ...style, wrapWidth: Math.max(0, Number(e.target.value)) })} style={{ width: 64 }} /></label>}
    {isTable && <label>{tr("Text alignment ")}<select aria-label={tr("Text alignment")} value={style?.align ?? 'left'} onChange={e => setStyle({ ...style, align: e.target.value as 'left' | 'center' | 'right' })}><option value="left">{tr("Left")}</option><option value="center">{tr("Center")}</option><option value="right">{tr("Right")}</option></select></label>}
    <label><input type="checkbox" checked={Boolean(background)} onChange={e => setBackground(e.target.checked ? '#2962ff' : '')} /> {tr(" Background")}</label>
    {background && <input type="color" aria-label={tr("Background color")} value={background} onChange={e => setBackground(e.target.value)} />}
    <label><input type="checkbox" checked={style?.border ?? false} onChange={e => setStyle({ ...style, border: e.target.checked })} /> {tr(" Border")}</label>
    </>}
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
      <button type="button" onClick={cancel}>{tr("Cancel")}</button>
      <button type="button" onClick={save}>{tr("OK")}</button>
    </div>
  </div>, document.body);
}
