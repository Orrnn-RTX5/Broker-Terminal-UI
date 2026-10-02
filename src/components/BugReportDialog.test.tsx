// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BugReportDialog } from './BugReportDialog';
import { fetchBugReportOptions, submitBugReport } from '../services/bugReportService';

vi.mock('../services/bugReportService', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/bugReportService')>(),
  fetchBugReportOptions: vi.fn(), submitBugReport: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(fetchBugReportOptions).mockResolvedValue({ enabled: true });
  vi.mocked(submitBugReport).mockReset();
});

const fillReport = () => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Trade row selection' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'What happened?' }), { target: { value: 'The highlight remains after clicking the chart.' } });
};

describe('bug report form', () => {
  it('validates required fields and shows the confirmed report ID and attachment failure notice', async () => {
    vi.mocked(submitBugReport).mockResolvedValue({ report_id: 'report-test-1', status: 'submitted', failed_attachments: [0] });
    render(<BugReportDialog isOpen onClose={vi.fn()} context={{ symbol: 'EURJPY', timeframe: 'M1' }} />);
    expect(screen.getByRole('button', { name: 'Send report' })).toBeDisabled();
    fillReport();
    fireEvent.click(screen.getByRole('button', { name: 'Add steps to reproduce' }));
    fireEvent.change(screen.getByLabelText('Steps (one per line)'), { target: { value: 'Select a row\nClick the chart' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await screen.findByText('Bug report sent');
    expect(screen.getByText('report-test-1')).toBeInTheDocument();
    expect(screen.getByText('The report was sent, but an attachment could not be uploaded.')).toBeInTheDocument();
    expect(submitBugReport).toHaveBeenCalledWith(expect.objectContaining({ form: expect.objectContaining({ title: 'Trade row selection', steps: 'Select a row\nClick the chart' }), context: { symbol: 'EURJPY', timeframe: 'M1' } }));
  });

  it('keeps the draft after a server error so the user can retry', async () => {
    vi.mocked(submitBugReport).mockRejectedValueOnce(new Error('The support service could not be reached.'));
    render(<BugReportDialog isOpen onClose={vi.fn()} />);
    fillReport();
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The support service could not be reached.');
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Trade row selection');
    expect(screen.getByRole('button', { name: 'Send report' })).toBeEnabled();
    expect(screen.queryByText('Bug report sent')).not.toBeInTheDocument();
  });

  it('allows attaching a screenshot and sends it without a screen capture action', async () => {
    vi.mocked(submitBugReport).mockResolvedValue({ report_id: 'report-test-3', status: 'submitted' });
    const { container } = render(<BugReportDialog isOpen onClose={vi.fn()} />);
    fillReport();
    expect(screen.queryByRole('button', { name: 'Capture this screen' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach file' })).toBeEnabled();
    const screenshot = new File(['image'], 'terminal.webp', { type: 'image/webp' });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [screenshot] } });
    expect(screen.getByText('terminal.webp')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send report' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await screen.findByText('Bug report sent');
    expect(submitBugReport).toHaveBeenCalledWith(expect.objectContaining({ attachments: [screenshot] }));
  });

  it('prevents closing the form while its submission is pending', async () => {
    let finishSubmit!: (receipt: { report_id: string; status: string }) => void;
    vi.mocked(submitBugReport).mockImplementation(() => new Promise(resolve => { finishSubmit = resolve; }));
    const onClose = vi.fn();
    render(<BugReportDialog isOpen onClose={onClose} />);
    fillReport();
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finishSubmit({ report_id: 'report-test-4', status: 'submitted' }));
    await screen.findByText('Bug report sent');
  });

  it('enables Send report for an attachment alone and supplies valid basic report text', async () => {
    vi.mocked(submitBugReport).mockResolvedValue({ report_id: 'attachment-only-report', status: 'submitted' });
    const { container } = render(<BugReportDialog isOpen onClose={vi.fn()} />);
    const title = screen.getByRole('textbox', { name: 'Title' });
    const description = screen.getByRole('textbox', { name: 'What happened?' });
    const screenshot = new File(['image'], 'issue.png', { type: 'image/png' });
    expect(screen.getByRole('button', { name: 'Send report' })).toBeDisabled();
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [screenshot] } });
    expect(screen.getByRole('button', { name: 'Send report' })).toBeEnabled();
    expect(title).not.toBeRequired();
    expect(description).not.toBeRequired();
    expect(container.querySelector('form')!.checkValidity()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await screen.findByText('Bug report sent');
    expect(submitBugReport).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [screenshot],
      form: expect.objectContaining({
        title: 'Bug report with attachments',
        description: 'Please review the attached files for the reported issue.',
      }),
    }));
  });

  it('restores text requirements after removing the only attachment and rejects unsupported files', async () => {
    const { container } = render(<BugReportDialog isOpen onClose={vi.fn()} />);
    const input = container.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(['image'], 'issue.png', { type: 'image/png' })] } });
    expect(screen.getByRole('button', { name: 'Send report' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove issue.png' }));
    expect(screen.getByRole('button', { name: 'Send report' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeRequired();
    fireEvent.change(input, { target: { files: [new File(['video'], 'issue.mp4', { type: 'video/mp4' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('not an accepted type');
    expect(screen.getByRole('button', { name: 'Send report' })).toBeDisabled();
  });

  it('keeps short user notes when preparing an attachment report', async () => {
    vi.mocked(submitBugReport).mockResolvedValue({ report_id: 'short-note-report', status: 'submitted' });
    const { container } = render(<BugReportDialog isOpen onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'UI' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'What happened?' }), { target: { value: '?' } });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['log'], 'issue.txt', { type: 'text/plain' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await screen.findByText('Bug report sent');
    expect(submitBugReport).toHaveBeenCalledWith(expect.objectContaining({ form: expect.objectContaining({
      title: 'Bug report with attachments: UI',
      description: '?\n\nPlease review the attached files for the reported issue.',
    }) }));
  });

  it('shows the broker-disabled message', async () => {
    vi.mocked(fetchBugReportOptions).mockResolvedValue({ enabled: false });
    render(<BugReportDialog isOpen onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Bug reporting is not enabled on this server yet.')).toBeInTheDocument());
  });

  it('focuses the title, contains keyboard navigation, and restores focus on close', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const { rerender } = render(<BugReportDialog isOpen onClose={onClose} />);
    const title = screen.getByRole('textbox', { name: 'Title' });
    await waitFor(() => expect(title).toHaveFocus());
    const close = screen.getByRole('button', { name: 'Close' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(close).toHaveFocus();
    fillReport();
    const send = screen.getByRole('button', { name: 'Send report' });
    send.focus();
    fireEvent.keyDown(send, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    rerender(<BugReportDialog isOpen={false} onClose={onClose} />);
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
