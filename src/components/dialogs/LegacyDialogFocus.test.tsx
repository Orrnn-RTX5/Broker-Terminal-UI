import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartTemplateDialog } from '../ChartTemplateDialog';
import { ExitConfirmDialog } from './ExitConfirmDialog';
import { PrintSetupDialog } from './PrintSetupDialog';
import { SaveWorkspaceDialog } from './SaveWorkspaceDialog';

const { getProfile, saveProfile } = vi.hoisted(() => ({ getProfile: vi.fn(), saveProfile: vi.fn() }));
vi.mock('../../hooks/useUiTranslation', () => ({ useUiTranslation: () => (text: string) => text, translateUi: (text: string) => text }));
vi.mock('../../services/localWorkspaceProfiles', () => ({ getWorkspaceProfile: getProfile, saveCurrentWorkspaceProfile: saveProfile }));

type Sheet = 'template' | 'print' | 'workspace' | 'exit';
const changes = { hasWorkspaceChanges: true, hasOpenTrades: true, hasDraftOrders: false, openTradesCount: 2, draftOrdersCount: 0, workspaceModified: true };

function Host({ sheet, onConfirm }: { sheet: Sheet; onConfirm: () => void }) {
  const [isOpen, setOpen] = useState(false);
  const close = () => setOpen(false);
  return <>
    <button onClick={() => setOpen(true)}>Open sheet</button>
    {sheet === 'template' && <ChartTemplateDialog isOpen={isOpen} onClose={close} mode="load" onLoadTemplate={onConfirm} />}
    {sheet === 'exit' && <ExitConfirmDialog isOpen={isOpen} onCancel={close} onConfirm={onConfirm} changes={changes} />}
    {isOpen && sheet === 'print' && <PrintSetupDialog onCancel={close} onConfirm={onConfirm} />}
    {isOpen && sheet === 'workspace' && <SaveWorkspaceDialog accountId="test-account" onCancel={close} onConfirm={onConfirm} />}
  </>;
}

beforeEach(() => { getProfile.mockReturnValue(null); saveProfile.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('legacy sheet keyboard ownership', () => {
  it.each([
    ['template', 'Load Chart Template', 'Close'],
    ['print', 'Print Setup', 'Cancel'],
    ['workspace', 'Save Workspace', 'Workspace Name'],
    ['exit', 'Confirm Exit', 'Cancel'],
  ] as const)('%s contains Tab and restores focus on Escape without confirming', async (sheet, name, initialName) => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Host sheet={sheet} onConfirm={onConfirm} />);
    const opener = screen.getByRole('button', { name: 'Open sheet' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(sheet === 'workspace' ? screen.getByLabelText(initialName) : screen.getByRole('button', { name: initialName })).toHaveFocus();
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea')).filter(element => !element.matches(':disabled'));
    controls.at(-1)!.focus();
    await user.tab();
    expect(controls[0]).toHaveFocus();
    await user.tab({ shift: true });
    expect(controls.at(-1)).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it('keeps overwrite confirmation focused on Back and allows Escape without writing', async () => {
    getProfile.mockReturnValue({ name: 'Default' });
    const user = userEvent.setup();
    render(<Host sheet="workspace" onConfirm={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Open sheet' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('dialog', { name: 'Overwrite Workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it('does not exit when Enter is pressed on the initial Cancel action', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Host sheet="exit" onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Open sheet' }));
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('associates Print Setup fields with their visible names', () => {
    render(<PrintSetupDialog onConfirm={vi.fn()} onCancel={vi.fn()} />);
    for (const name of ['Orientation', 'Paper Size', 'Color Mode']) expect(screen.getByRole('combobox', { name })).toBeInTheDocument();
    for (const name of ['Top', 'Right', 'Bottom', 'Left']) expect(screen.getByRole('spinbutton', { name })).toBeInTheDocument();
  });

  it('bounds a dragged template sheet and reclamps it after viewport shrink', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    render(<ChartTemplateDialog isOpen onClose={vi.fn()} mode="load" />);
    const dialog = screen.getByRole('dialog', { name: 'Load Chart Template' });
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 290, top: 200, right: 710, bottom: 600, width: 420, height: 400, x: 290, y: 200, toJSON: () => ({}) });
    const header = screen.getByRole('heading', { name: 'Load Chart Template' }).closest('div')!.parentElement!;
    // Supply pointer coordinates explicitly because jsdom does not implement PointerEvent.
    const pointer = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      fireEvent(header, event);
    };
    pointer('pointerdown', 300, 210);
    pointer('pointermove', 2000, 2000);
    expect(dialog.style.transform).toBe('translate(282px, 192px)');
    pointer('pointerup', 2000, 2000);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(500);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(450);
    fireEvent(window, new Event('resize'));
    expect(dialog.style.transform).toBe('translate(32px, 17px)');
  });
});
