import { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useDialogFocusScope } from './useDialogFocusScope';

function Sheet({ isOpen = true, onClose, closeOnEscape = true, nested = false }: {
  isOpen?: boolean; onClose: () => void; closeOnEscape?: boolean; nested?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useDialogFocusScope({ isOpen, dialogRef, onClose, initialFocusRef: cancelRef, closeOnEscape });
  if (!isOpen) return null;
  return <div ref={dialogRef} role="dialog" aria-label="Test sheet" tabIndex={-1}>
    <button ref={cancelRef}>Cancel</button>
    <button disabled>Disabled</button>
    <div hidden><button>Hidden</button></div>
    <button style={{ display: 'none' }}>Not displayed</button>
    <input aria-label="Name" />
    <button>Confirm</button>
    {nested && <div role="dialog" aria-label="Nested sheet"><button>Nested close</button></div>}
  </div>;
}

describe('useDialogFocusScope', () => {
  it('focuses the safe initial control and wraps Tab in DOM order around available controls', async () => {
    const user = userEvent.setup();
    render(<Sheet onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
    screen.getByRole('button', { name: 'Confirm' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Confirm' }), { key: 'Tab', repeat: true });
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('uses the current close callback without resetting focus on rerender', () => {
    const first = vi.fn();
    const latest = vi.fn();
    const view = render(<Sheet onClose={first} />);
    const name = screen.getByRole('textbox', { name: 'Name' });
    name.focus();
    view.rerender(<Sheet onClose={latest} />);
    expect(name).toHaveFocus();
    fireEvent.keyDown(name, { key: 'Escape' });
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
  });

  it('does not claim nested, prevented, composing, or outside Escape events and never dispatches Enter', () => {
    const close = vi.fn();
    render(<Sheet onClose={close} nested />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Nested close' }), { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Confirm' }), { key: 'Escape', isComposing: true });
    const prevented = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    prevented.preventDefault();
    screen.getByRole('button', { name: 'Cancel' }).dispatchEvent(prevented);
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Test sheet' }), { key: 'Enter' });
    expect(close).not.toHaveBeenCalled();
  });

  it('updates the Escape lock without moving focus', () => {
    const close = vi.fn();
    const view = render(<Sheet onClose={close} closeOnEscape={false} />);
    const name = screen.getByRole('textbox', { name: 'Name' });
    name.focus();
    fireEvent.keyDown(name, { key: 'Escape' });
    expect(close).not.toHaveBeenCalled();
    view.rerender(<Sheet onClose={close} closeOnEscape />);
    expect(name).toHaveFocus();
    fireEvent.keyDown(name, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('restores the opener on close but does not steal focus from another active surface', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Open</button><button onClick={() => setOpen(false)}>Other surface</button>
        <Sheet isOpen={open} onClose={() => setOpen(false)} /></>;
    }
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Other surface' }));
    expect(screen.getByRole('button', { name: 'Other surface' })).toHaveFocus();
  });

  it('keeps Tab on an empty dialog container', () => {
    function Empty() {
      const dialogRef = useRef<HTMLDivElement>(null);
      useDialogFocusScope({ isOpen: true, dialogRef, onClose: vi.fn() });
      return <div ref={dialogRef} tabIndex={-1} role="dialog" aria-label="Empty" />;
    }
    render(<Empty />);
    const dialog = screen.getByRole('dialog', { name: 'Empty' });
    expect(dialog).toHaveFocus();
    expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false);
    expect(dialog).toHaveFocus();
  });
});
