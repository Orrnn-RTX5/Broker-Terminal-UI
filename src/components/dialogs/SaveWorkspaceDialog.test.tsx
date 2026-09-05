import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOCAL_WORKSPACE_PROFILES_STORAGE_KEY,
  listWorkspaceProfiles,
} from '../../services/localWorkspaceProfiles';
import { SaveWorkspaceDialog } from './SaveWorkspaceDialog';

describe('SaveWorkspaceDialog local workspace integration', () => {
  beforeEach(() => {
    localStorage.removeItem(LOCAL_WORKSPACE_PROFILES_STORAGE_KEY);
  });

  it('saves a workspace locally for the active account', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <SaveWorkspaceDialog
        accountId="200002"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith('Default');
    });
    expect(listWorkspaceProfiles('200002')).toEqual([
      expect.objectContaining({ accountId: '200002', name: 'Default' }),
    ]);
  });

  it('does not report success without an active account', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<SaveWorkspaceDialog onConfirm={onConfirm} onCancel={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('No active trading account is available for this workspace.')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
