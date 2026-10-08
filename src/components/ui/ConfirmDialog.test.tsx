import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useConfirmStore } from '../../store/useConfirmStore';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog keyboard safety', () => {
  beforeEach(() => useConfirmStore.getState().closeConfirm());

  it('starts on Cancel and requires the focused native action to confirm', async () => {
    const user = userEvent.setup();
    let result: Promise<boolean> | undefined;
    render(<><button onClick={() => {
      result = useConfirmStore.getState().showConfirm('Clear history', 'Remove cached records?', { danger: true, confirmLabel: 'Clear' });
    }}>Open confirmation</button><ConfirmDialog /></>);
    await user.click(screen.getByRole('button', { name: 'Open confirmation' }));
    expect(screen.getByRole('alertdialog', { name: 'Clear history' })).toHaveAccessibleDescription('Remove cached records?');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(useConfirmStore.getState().isOpen).toBe(true);
    await user.keyboard('{Enter}');
    await expect(result!).resolves.toBe(false);
    expect(screen.getByRole('button', { name: 'Open confirmation' })).toHaveFocus();
  });

  it('closes the owned sheet with Escape without invoking confirmation', async () => {
    const user = userEvent.setup();
    let result: Promise<boolean> | undefined;
    render(<><button onClick={() => { result = useConfirmStore.getState().showConfirm('Remove item', 'Confirm removal'); }}>Open</button><ConfirmDialog /></>);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.tab();
    expect(screen.getByRole('button', { name: 'OK' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();
    await user.keyboard('{Escape}');
    await expect(result!).resolves.toBe(false);
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });
});
