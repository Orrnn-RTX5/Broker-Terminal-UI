// @vitest-environment jsdom
import '@testing-library/jest-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnnotationEditor } from './AnnotationEditor';
import { drawingManager } from '../services/drawingManager';
import type { Drawing } from './model/drawing';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function open(subtype = 'text', isNew = false, properties: Partial<Drawing> = {}) {
  const drawing: Drawing = { id: 'annotation-id', type: 'text', subtype, points: [{ time: 123, price: 12 }], text: 'Existing', color: '#2962ff', ...properties };
  vi.spyOn(drawingManager, 'getDrawings').mockReturnValue([drawing]);
  render(<AnnotationEditor />);
  act(() => window.dispatchEvent(new CustomEvent('drawing:edit-annotation', { detail: { drawing, contextId: 'chart-one', x: 100, y: 100, isNew } })));
  return drawing;
}
describe('annotation editor', () => {
  it.each([
    { isNew: true, modifier: 'Ctrl', modifiers: { ctrlKey: true } },
    { isNew: true, modifier: 'Cmd', modifiers: { metaKey: true } },
    { isNew: false, modifier: 'Ctrl', modifiers: { ctrlKey: true } },
    { isNew: false, modifier: 'Cmd', modifiers: { metaKey: true } },
  ])('saves $isNew annotation with $modifier+Enter without bubbling into chart shortcuts', ({ isNew, modifiers }) => {
    const update = vi.spyOn(drawingManager, 'updateDrawingProperties').mockReturnValue(true);
    const background = vi.fn();
    open('text', isNew);
    document.addEventListener('keydown', background);
    try {
      const input = screen.getByLabelText('Annotation text');
      fireEvent.change(input, { target: { value: 'First line\nSecond line' } });
      fireEvent.keyDown(input, { key: 'Enter', ...modifiers });
      expect(update).toHaveBeenCalledExactlyOnceWith('annotation-id', expect.objectContaining({ text: 'First line\nSecond line' }), 'chart-one');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(background).not.toHaveBeenCalled();
    } finally { document.removeEventListener('keydown', background); }
  });

  it('creates text inline and commits when focus leaves the chart text field', () => {
    const update = vi.spyOn(drawingManager, 'updateDrawingProperties').mockReturnValue(true);
    open('text', true, { text: 'Text' });
    const text = screen.getByLabelText('Annotation text');
    expect(text).toHaveValue('');
    fireEvent.change(text, { target: { value: 'Inline\nText' } });
    fireEvent.blur(text, { relatedTarget: document.body });
    expect(update).toHaveBeenCalledWith('annotation-id', expect.objectContaining({ text: 'Inline\nText' }), 'chart-one');
  });
  it('saves multiline text to the originating chart and keeps a literal tool name', () => {
    const update = vi.spyOn(drawingManager, 'updateDrawingProperties').mockReturnValue(true);
    open('text', false, { text: 'Text' });
    expect(screen.getByLabelText('Annotation text')).toHaveValue('Text');
    fireEvent.change(screen.getByLabelText('Annotation text'), { target: { value: 'First\nSecond' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(update).toHaveBeenCalledWith('annotation-id', expect.objectContaining({ text: 'First\nSecond' }), 'chart-one');
  });
  it('cancels new drawings but leaves existing drawings intact', () => {
    const remove = vi.spyOn(drawingManager, 'deleteDrawing').mockReturnValue(true);
    open('note', true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(remove).toHaveBeenCalledWith('annotation-id', 'chart-one');
    cleanup(); remove.mockClear(); open();
    fireEvent.keyDown(screen.getByLabelText('Annotation text'), { key: 'Escape' });
    expect(remove).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('rejects an invalid link before saving an attachment', () => {
    const update = vi.spyOn(drawingManager, 'updateDrawingProperties').mockReturnValue(true);
    open('post'); fireEvent.change(screen.getByLabelText('Post link'), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.getByRole('alert')).toHaveTextContent('valid link'); expect(update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Post link'), { target: { value: 'https://x.com/tradingview/status/12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(update).toHaveBeenCalledWith('annotation-id', expect.objectContaining({ annotation: { url: 'https://x.com/tradingview/status/12345' } }), 'chart-one');
  });
  it('keeps table content when adding a row and column', () => {
    const update = vi.spyOn(drawingManager, 'updateDrawingProperties').mockReturnValue(true);
    open('table', false, { annotation: { tableData: [['Symbol', 'Bias']] } });
    fireEvent.change(screen.getByLabelText('Table rows'), { target: { value: 2 } });
    fireEvent.change(screen.getByLabelText('Table columns'), { target: { value: 3 } });
    fireEvent.change(screen.getByLabelText('Row 2 column 3'), { target: { value: 'Saved' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(update).toHaveBeenCalledWith('annotation-id', expect.objectContaining({ annotation: { tableData: [['Symbol', 'Bias', ''], ['', '', 'Saved']] } }), 'chart-one');
  });
  it('does not leave a pending drawing on a symbol change', () => {
    const remove = vi.spyOn(drawingManager, 'deleteDrawing').mockReturnValue(true);
    open('image', true);
    act(() => window.dispatchEvent(new Event('chartSymbolChanged')));
    expect(remove).toHaveBeenCalledWith('annotation-id', 'chart-one'); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('rejects unsupported upload formats and oversized files', () => {
    open('image');
    const file = new File(['<svg/>'], 'unsafe.svg', { type: 'image/svg+xml' });
    fireEvent.change(screen.getByLabelText('Choose image'), { target: { files: [file] } });
    expect(screen.getByRole('alert')).toHaveTextContent('JPG, PNG or WEBP');
    const large = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Choose image'), { target: { files: [large] } });
    expect(screen.getByRole('alert')).toHaveTextContent('up to 2 MB');
  });
});
