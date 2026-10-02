// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { BugReportHost } from './BugReportHost';
import { fetchBugReportOptions } from '../services/bugReportService';

vi.mock('../services/bugReportService', async importOriginal => ({
  ...await importOriginal<typeof import('../services/bugReportService')>(),
  fetchBugReportOptions: vi.fn().mockResolvedValue({ enabled: true }),
}));

it('loads a working report form only when requested and closes it without submitting a report', async () => {
  render(<BugReportHost />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(fetchBugReportOptions).not.toHaveBeenCalled();
  act(() => window.dispatchEvent(new CustomEvent('rtx5:open-bug-report', { detail: { symbol: 'EURUSD', timeframe: 'M1' } })));
  await screen.findByRole('dialog', { name: 'Report a Bug' });
  expect(screen.getByRole('textbox', { name: 'Title' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
