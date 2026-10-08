import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MarketWatchSaveSetDialog } from './MarketWatchSaveSetDialog';

describe('MarketWatchSaveSetDialog', () => {
  it('keeps editing focus through value changes, contains Tab, and cancels back to the opener', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(false);
      const [name, setName] = useState('');
      return <><button onClick={() => setOpen(true)}>Open Save Set</button>
        <MarketWatchSaveSetDialog isOpen={open} value={name} onChange={setName} onCancel={() => setOpen(false)} onSave={save} /></>;
    }
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open Save Set' }));
    const name = screen.getByRole('textbox', { name: 'Set name' });
    expect(name).toHaveFocus();
    await user.type(name, 'Watch list');
    expect(name).toHaveValue('Watch list');
    expect(name).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
    await user.tab();
    expect(name).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Open Save Set' })).toHaveFocus();
  });
});
