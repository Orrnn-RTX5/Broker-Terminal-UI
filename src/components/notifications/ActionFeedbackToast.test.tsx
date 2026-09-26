import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionFeedbackToast, resolveActionFeedbackDurationMs, resolveActionFeedbackTone } from './ActionFeedbackToast';
import { buildPositionCloseReport } from './positionCloseReport';

const row = (ticket: number, overrides: Partial<Parameters<typeof buildPositionCloseReport>[0]['rows'][number]> = {}) => ({
  ticket,
  symbol: 'BTCUSD',
  side: 'SELL' as const,
  volume: 0.1,
  openPrice: 83500,
  closePrice: 83269.96,
  profit: 23,
  digits: 2,
  ...overrides,
});

describe('buildPositionCloseReport', () => {
  it('sums known profits of closed rows only and lists rejections first', () => {
    const report = buildPositionCloseReport({
      scope: 'ALL',
      rows: [row(1, { profit: 10 }), row(2, { profit: -4 }), row(3, { profit: null }), row(4, { profit: 99 })],
      confirmedTicketIds: [1, 2, 3],
      failedTicketIds: [4],
      currency: 'USD',
      failureReason: 'Market closed',
      completedAt: 0,
    });

    expect(report.requested).toBe(4);
    expect(report.closed).toBe(3);
    expect(report.realizedProfit).toBe(6);
    expect(report.rows.map((entry) => [entry.ticket, entry.status])).toEqual([
      [4, 'rejected'], [1, 'closed'], [2, 'closed'], [3, 'closed'],
    ]);
    expect(report.failureReason).toBe('Market closed');
  });

  it('reports an unknown total instead of a misleading zero', () => {
    const report = buildPositionCloseReport({
      scope: 'ALL', rows: [row(1, { profit: null })], confirmedTicketIds: [1], failedTicketIds: [],
    });
    expect(report.realizedProfit).toBeNull();
    expect(report.failureReason).toBeUndefined();
  });
});

describe('ActionFeedbackToast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps compact results readable long enough to scan', () => {
    expect(resolveActionFeedbackDurationMs('success')).toBe(6000);
    expect(resolveActionFeedbackDurationMs('error')).toBe(9000);
  });

  it('limits every close receipt scope and outcome to one second total', () => {
    const completed = buildPositionCloseReport({
      scope: 'ALL', rows: [row(1)], confirmedTicketIds: [1], failedTicketIds: [],
    });
    const completedWinners = buildPositionCloseReport({
      scope: 'WINNERS', rows: [row(1, { profit: 5 })], confirmedTicketIds: [1], failedTicketIds: [],
    });
    const completedLosers = buildPositionCloseReport({
      scope: 'LOSERS', rows: [row(1, { profit: -5 })], confirmedTicketIds: [1], failedTicketIds: [],
    });
    const partial = buildPositionCloseReport({
      scope: 'ALL', rows: [row(1), row(2)], confirmedTicketIds: [1], failedTicketIds: [2],
    });
    const failed = buildPositionCloseReport({
      scope: 'WINNERS', rows: [row(1)], confirmedTicketIds: [], failedTicketIds: [1],
    });

    expect(resolveActionFeedbackDurationMs('success', completed)).toBe(1000);
    expect(resolveActionFeedbackDurationMs('success', completedWinners)).toBe(1000);
    expect(resolveActionFeedbackDurationMs('success', completedLosers)).toBe(1000);
    expect(resolveActionFeedbackDurationMs('error', partial)).toBe(1000);
    expect(resolveActionFeedbackDurationMs('error', failed)).toBe(1000);
  });

  it('renders a close receipt with side, volume, prices, ticket, and realized P&L', () => {
    const report = buildPositionCloseReport({
      scope: 'ALL', symbol: 'BTCUSD', rows: [row(1001353)], confirmedTicketIds: [1001353], failedTicketIds: [], currency: 'USD',
    });
    const { container } = render(
      <ActionFeedbackToast
        durationMs={resolveActionFeedbackDurationMs('success', report)}
        message="Positions: closed 1"
        onDismiss={() => {}}
        report={report}
        tone={resolveActionFeedbackTone('success', report)}
      />,
    );

    const toast = screen.getByTestId('action-feedback-toast');
    expect(toast).toHaveAttribute('data-tone', 'success');
    expect(toast).toHaveClass('rtx-action-feedback--report');
    expect(toast.closest('.rtx-action-feedback-region')).toHaveClass('rtx-action-feedback-region--center');
    expect(document.querySelector('.rtx-action-feedback-backdrop')).toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
    expect(screen.getByRole('heading', { name: 'Position closed' })).toBeInTheDocument();
    expect(screen.getByText('Close All Positions')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 1 closed at market')).toBeInTheDocument();
    expect(screen.getByText('#1001353')).toBeInTheDocument();
    expect(screen.getByText('83,500.00')).toBeInTheDocument();
    expect(screen.getByText('83,269.96')).toBeInTheDocument();
    expect(screen.getByText('Est. realized P&L')).toBeInTheDocument();
    expect(toast.textContent).toContain('+23.00USD');
    expect(toast.textContent).not.toContain('Positions: closed 1');
  });

  it('renders a bulk loss receipt with loss tone and aggregate realized P&L', () => {
    const report = buildPositionCloseReport({
      scope: 'LOSERS', symbol: 'BTCUSD', rows: [
        row(467964, { profit: -0.63, openPrice: 84310.45, closePrice: 84220.03, volume: 0.01 }),
        row(467965, { profit: -1.37, openPrice: 84320.45, closePrice: 84210.03, volume: 0.01 }),
      ],
      confirmedTicketIds: [467964, 467965], failedTicketIds: [], currency: 'USD',
    });
    render(
      <ActionFeedbackToast
        durationMs={resolveActionFeedbackDurationMs('success', report)}
        message="Position closed #467964"
        onDismiss={() => {}}
        report={report}
        tone={resolveActionFeedbackTone('success', report)}
      />,
    );

    const toast = screen.getByTestId('action-feedback-toast');
    expect(toast).toHaveAttribute('data-tone', 'loss');
    expect(screen.getByRole('heading', { name: 'Positions closed' })).toBeInTheDocument();
    expect(screen.getByText('Loss')).toBeInTheDocument();
    expect(screen.getByText('Close In-Loss Positions')).toBeInTheDocument();
    expect(screen.getByText('2 of 2 closed at market')).toBeInTheDocument();
    expect(screen.getByText('#467964')).toBeInTheDocument();
    expect(toast.textContent).toContain('-2.00USD');
  });

  it('flags a partial close with the rejected ticket and broker reason', () => {
    const report = buildPositionCloseReport({
      scope: 'LOSERS', rows: [row(1), row(2)], confirmedTicketIds: [1], failedTicketIds: [2], failureReason: 'Off quotes',
    });
    render(
      <ActionFeedbackToast durationMs={resolveActionFeedbackDurationMs('error', report)} message="" onDismiss={() => {}} report={report} tone={resolveActionFeedbackTone('error', report)} />,
    );

    expect(screen.getByTestId('action-feedback-toast')).toHaveAttribute('data-tone', 'warning');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Partially closed' })).toBeInTheDocument();
    expect(screen.getByText('Close In-Loss Positions')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('Off quotes')).toBeInTheDocument();
  });

  it('summarises closed volume and expands the remaining positions on demand', () => {
    const tickets = [1, 2, 3, 4, 5, 6];
    const report = buildPositionCloseReport({
      scope: 'WINNERS', symbol: 'BTCUSD', rows: tickets.map(ticket => row(ticket)),
      confirmedTicketIds: tickets, failedTicketIds: [], currency: 'USD',
    });
    render(<ActionFeedbackToast durationMs={resolveActionFeedbackDurationMs('success', report)} message="" onDismiss={() => {}} report={report} tone="success" />);

    expect(screen.getByText('0.60')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(1 + 4);
    const toggle = screen.getByRole('button', { name: '+2 more' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(screen.getAllByRole('row')).toHaveLength(1 + 6);
    expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens the receipt as a labelled modal dialog that Esc and the Dismiss button close', () => {
    const report = buildPositionCloseReport({
      scope: 'ALL', symbol: 'BTCUSD', rows: [row(467964)], confirmedTicketIds: [467964], failedTicketIds: [], currency: 'USD',
    });
    const onDismiss = vi.fn();
    const { unmount } = render(<ActionFeedbackToast durationMs={1000} message="" onDismiss={onDismiss} report={report} tone="success" />);

    const dialog = screen.getByRole('dialog', { name: 'Position closed' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dialog).toHaveClass('is-exiting');
    act(() => { vi.advanceTimersByTime(160); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    unmount();

    const onDismissButton = vi.fn();
    render(<ActionFeedbackToast durationMs={1000} message="" onDismiss={onDismissButton} report={report} tone="success" />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    act(() => { vi.advanceTimersByTime(160); });
    expect(onDismissButton).toHaveBeenCalledTimes(1);
  });

  it('dismisses a focused and hovered bulk sheet within the strict one-second total', () => {
    const report = buildPositionCloseReport({
      scope: 'ALL', symbol: 'BTCUSD', rows: [row(1)], confirmedTicketIds: [1], failedTicketIds: [],
    });
    const onDismiss = vi.fn();
    render(<ActionFeedbackToast durationMs={60_000} message="" onDismiss={onDismiss} report={report} tone="success" />);

    const dialog = screen.getByRole('dialog');
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveFocus();
    fireEvent.mouseEnter(dialog);

    act(() => { vi.advanceTimersByTime(839); });
    expect(dialog).not.toHaveClass('is-exiting');
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1); });
    expect(dialog).toHaveClass('is-exiting');
    act(() => { vi.advanceTimersByTime(159); });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('moves focus into the centered sheet and restores the prior control on unmount', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Close all';
    document.body.appendChild(trigger);
    trigger.focus();
    const report = buildPositionCloseReport({
      scope: 'ALL', rows: [row(1)], confirmedTicketIds: [1], failedTicketIds: [],
    });

    const { unmount } = render(
      <ActionFeedbackToast durationMs={1000} message="" onDismiss={() => {}} report={report} tone="success" />,
    );
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveFocus();

    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('auto-dismisses after its lifetime and pauses while hovered', () => {
    const onDismiss = vi.fn();
    render(<ActionFeedbackToast durationMs={4000} message="Workspace saved" onDismiss={onDismiss} tone="success" />);
    const toast = screen.getByTestId('action-feedback-toast');

    act(() => { vi.advanceTimersByTime(3000); });
    fireEvent.mouseEnter(toast);
    expect(toast).toHaveClass('is-paused');
    act(() => { vi.advanceTimersByTime(20000); });
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.mouseLeave(toast);
    act(() => { vi.advanceTimersByTime(999); });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1 + 160); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders structured action details with a clear heading and outcome channel', () => {
    render(
      <ActionFeedbackToast
        durationMs={4000}
        message="Market Watch exported to clipboard (62 symbols)"
        notice={{
          title: 'Market Watch',
          description: 'Export · 62 Symbols',
          metaLabel: 'Destination',
          meta: 'System clipboard',
          metaIcon: 'copy',
          hint: 'No file was created. Press Ctrl+V to paste into Excel or another app.',
        }}
        onDismiss={() => {}}
        tone="success"
      />,
    );

    const toast = screen.getByRole('status');
    expect(screen.getByRole('heading', { name: 'Market Watch' })).toBeInTheDocument();
    expect(toast).toHaveTextContent('Completed');
    expect(toast).toHaveTextContent('Export · 62 Symbols');
    expect(toast).toHaveTextContent('Destination');
    expect(toast).toHaveTextContent('System clipboard');
    expect(toast).toHaveTextContent('No file was created. Press Ctrl+V to paste into Excel or another app.');
    expect(toast.querySelector('.rtx-action-feedback__channel svg')).toBeInTheDocument();
    expect(toast.closest('.rtx-action-feedback-region')).toHaveClass('rtx-action-feedback-region--notice-center');
    expect(toast.closest('.rtx-action-feedback-region')?.parentElement).toBe(document.body);
    expect(document.querySelector('.rtx-action-feedback-backdrop')).not.toBeInTheDocument();
  });

  it('routes a captured Market Watch export to the persistent native sheet', () => {
    const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
    const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
    const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: function (this: HTMLDialogElement) { this.removeAttribute('open'); },
    });
    const onDismiss = vi.fn();
    let unmount = () => {};

    try {
      ({ unmount } = render(
        <ActionFeedbackToast
          durationMs={6000}
          message="Market Watch exported to clipboard (4 symbols)"
          notice={{
            title: 'Market Watch',
            exportResult: {
              destination: 'clipboard',
              symbolCount: 4,
              columnCount: 3,
              csv: 'Symbol,Bid,Ask\nEURUSD,1.10001,1.10003',
              fileName: 'market-watch-captured.csv',
            },
          }}
          onDismiss={onDismiss}
          tone="success"
        />,
      ));

      const sheet = screen.getByRole('dialog', { name: 'Copied to clipboard' });
      expect(showModal).toHaveBeenCalledOnce();
      expect(sheet).toHaveAttribute('open');
      expect(sheet).toHaveAttribute('data-testid', 'market-watch-export-sheet');
      expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
      expect(screen.queryByTestId('action-feedback-toast')).not.toBeInTheDocument();
      expect(document.querySelector('.rtx-action-feedback__lifetime')).not.toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(60_000); });

      expect(sheet).toHaveAttribute('open');
      expect(onDismiss).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(onDismiss).toHaveBeenCalledOnce();
    } finally {
      unmount();
      if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
      if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
    }
  });

  it('dismisses from the close button after the exit animation', () => {
    const onDismiss = vi.fn();
    render(<ActionFeedbackToast durationMs={4000} message="Order failed" onDismiss={onDismiss} tone="error" />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByTestId('action-feedback-toast')).toHaveClass('is-exiting');
    act(() => { vi.advanceTimersByTime(160); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
