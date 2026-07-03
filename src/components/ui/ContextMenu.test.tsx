import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
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
