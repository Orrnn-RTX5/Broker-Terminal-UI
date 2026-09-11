// @vitest-environment jsdom
import '@testing-library/jest-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AnnotationTableCellEditor } from './AnnotationTableCellEditor';
import { drawingManager, type Drawing } from '../services/drawingManager';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function open({ tableData = [['First', 'Next']], row = 0, column = 0 } = {}) {
  const drawing: Drawing = { id: 'table', type: 'text', subtype: 'table', points: [{ time: 1, price: 1 }], annotation: { tableData, cellWidth: 90 } };
  vi.spyOn(drawingManager, 'getDrawings').mockReturnValue([drawing]);
  render(<AnnotationTableCellEditor />);
  act(() => window.dispatchEvent(new CustomEvent('drawing:edit-table-cell', { detail: { drawing, contextId: 'chart', row, column, x: 10, y: 10, width: 90, height: 32 } })));
}
it.each([
  { key: 'Enter', shiftKey: false, destination: null },
  { key: 'Tab', shiftKey: false, destination: [1, 1] },
  { key: 'Tab', shiftKey: true, destination: [0, 1] },
])('saves with $key (Shift=$shiftKey) and moves only when requested', ({ key, shiftKey, destination }) => {
  const update = vi.spyOn(drawingManager, 'updateDrawingProperties').mockReturnValue(true);
  const next = vi.spyOn(drawingManager, 'editTableCell').mockImplementation(() => {});
  const background = vi.fn();
  open({ tableData: [['A', 'B'], ['C', 'D']], row: 1 });
  document.addEventListener('keydown', background);
  try {
    const cell = screen.getByLabelText('Table cell 2, 1');
    fireEvent.change(cell, { target: { value: 'Edited' } });
    expect(fireEvent.keyDown(cell, { key, shiftKey })).toBe(false);
    expect(update).toHaveBeenCalledExactlyOnceWith('table', { annotation: { tableData: [['A', 'B'], ['Edited', 'D']], cellWidth: 90 } }, 'chart');
    if (destination) expect(next).toHaveBeenCalledExactlyOnceWith('table', ...destination, 'chart');
    else expect(next).not.toHaveBeenCalled();
    expect(background).not.toHaveBeenCalled();
  } finally { document.removeEventListener('keydown', background); }
});
it('edits the selected cell and advances with Tab while preserving adjacent content and style', () => {
  const update = vi.spyOn(drawingManager, 'updateDrawingProperties').mockReturnValue(true);
  const next = vi.spyOn(drawingManager, 'editTableCell').mockImplementation(() => {});
  open(); const cell = screen.getByLabelText('Table cell 1, 1');
  expect(cell).toHaveFocus(); fireEvent.change(cell, { target: { value: 'Edited' } });
  fireEvent.keyDown(cell, { key: 'Tab' });
  expect(update).toHaveBeenCalledWith('table', { annotation: { tableData: [['Edited', 'Next']], cellWidth: 90 } }, 'chart');
  expect(next).toHaveBeenCalledWith('table', 0, 1, 'chart');
});
it('cancels with Escape without saving the cell', () => {
  const update = vi.spyOn(drawingManager, 'updateDrawingProperties').mockReturnValue(true);
  open(); fireEvent.change(screen.getByLabelText('Table cell 1, 1'), { target: { value: 'Discard' } });
  fireEvent.keyDown(screen.getByLabelText('Table cell 1, 1'), { key: 'Escape' });
  expect(update).not.toHaveBeenCalled(); expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});
