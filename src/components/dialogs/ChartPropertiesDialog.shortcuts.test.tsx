import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChartPropertiesDialog } from './ChartPropertiesDialog';

describe('Chart Properties keyboard ownership', () => {
  it('leaves a newer help dialog focused and closes only for its own Escape', () => {
    const onClose = vi.fn(); const nextClose = vi.fn();
    const { rerender } = render(<ChartPropertiesDialog isOpen symbol="EURUSD" timeframe="M1" onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveFocus();
    const help = document.createElement('div'); help.setAttribute('role', 'dialog'); help.dataset.shortcutScope = 'local';
    const button = document.createElement('button'); help.append(button); document.body.append(help); button.focus();
    const local = vi.fn(); help.addEventListener('keydown', local);
    try {
      rerender(<ChartPropertiesDialog isOpen symbol="EURUSD" timeframe="M1" onClose={nextClose} />);
      expect(button).toHaveFocus();
      fireEvent.keyDown(button, { key: 'Escape', cancelable: true });
      expect(local).toHaveBeenCalledOnce();
      expect(onClose).not.toHaveBeenCalled(); expect(nextClose).not.toHaveBeenCalled();
    } finally { help.remove(); }
    dialog.focus(); fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(nextClose).toHaveBeenCalledOnce();
  });
});
