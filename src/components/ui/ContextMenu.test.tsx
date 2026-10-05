import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu, type ContextMenuItemConfig } from './ContextMenu';

const waitForOutsideClickListener = () => new Promise(resolve => {
  window.setTimeout(resolve, 0);
});

function ControlledMenuToggle() {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const items: ContextMenuItemConfig[] = [
    { label: 'Balance', action: vi.fn(), autoClose: false },
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(prev => !prev)}
      >
        Footer metrics
      </button>
      <button type="button">Outside</button>
      {open && (
        <ContextMenu
          items={items}
          position={{ x: 0, y: 0 }}
          onClose={() => setOpen(false)}
          ignoredElements={[triggerRef.current]}
        />
      )}
    </>
  );
}

describe('ContextMenu', () => {
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  beforeEach(() => Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() }));
  afterEach(() => {
    cleanup();
    if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  });
  it('evaluates lazy items only while open and preserves updated eligibility and keyboard actions', () => {
    const action = vi.fn();
    const factory = vi.fn(() => [{ label: 'Order', action, disabled: true }]);
    const view = render(<ContextMenu items={factory}><button>Quote row</button></ContextMenu>);
    expect(factory).not.toHaveBeenCalled();
    fireEvent.contextMenu(screen.getByText('Quote row'));
    expect(factory).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Order'));
    expect(action).not.toHaveBeenCalled();
    const currentFactory = vi.fn(() => [{ label: 'Order enabled', action }]);
    view.rerender(<ContextMenu items={currentFactory}><button>Quote row</button></ContextMenu>);
    expect(currentFactory).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'o' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    const count = currentFactory.mock.calls.length;
    view.rerender(<ContextMenu items={currentFactory}><button>Quote row</button></ContextMenu>);
    expect(currentFactory).toHaveBeenCalledTimes(count);
    fireEvent.contextMenu(screen.getByText('Quote row'));
    expect(currentFactory).toHaveBeenCalledTimes(count + 1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does not evaluate lazy items when a child prevents the context menu', () => {
    const factory = vi.fn(() => [{ label: 'Order' }]);
    render(<ContextMenu items={factory}><button onContextMenu={event => event.preventDefault()}>Quote row</button></ContextMenu>);
    fireEvent.contextMenu(screen.getByText('Quote row'));
    expect(factory).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('lets an ignored trigger toggle a controlled menu closed', async () => {
    const user = userEvent.setup();
    render(<ControlledMenuToggle />);

    const trigger = screen.getByRole('button', { name: 'Footer metrics' });

    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await waitForOutsideClickListener();
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('still closes a controlled menu on non-ignored outside clicks', async () => {
    const user = userEvent.setup();
    render(<ControlledMenuToggle />);

    await user.click(screen.getByRole('button', { name: 'Footer metrics' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await waitForOutsideClickListener();
    await user.click(screen.getByRole('button', { name: 'Outside' }));

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });
});
