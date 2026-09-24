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

  it('renders a close receipt with side, volume, prices, ticket, and realized P&L', () => {
    const report = buildPositionCloseReport({
      scope: 'ALL', symbol: 'BTCUSD', rows: [row(1001353)], confirmedTicketIds: [1001353], failedTicketIds: [], currency: 'USD',
    });
    render(
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
    expect(screen.getByRole('heading', { name: 'Position closed' })).toBeInTheDocument();
    expect(screen.getByText('1 of 1 closed at market')).toBeInTheDocument();
    expect(screen.getByText('#1001353')).toBeInTheDocument();
    expect(screen.getByText('83,500.00')).toBeInTheDocument();
    expect(screen.getByText('83,269.96')).toBeInTheDocument();
    expect(screen.getByText('Est. realized P&L')).toBeInTheDocument();
    expect(toast.textContent).toContain('+23.00USD');
    expect(toast.textContent).not.toContain('Positions: closed 1');
  });

  it('flags a partial close with the rejected ticket and broker reason', () => {
    const report = buildPositionCloseReport({
      scope: 'LOSERS', rows: [row(1), row(2)], confirmedTicketIds: [1], failedTicketIds: [2], failureReason: 'Off quotes',
    });
    render(
      <ActionFeedbackToast durationMs={10000} message="" onDismiss={() => {}} report={report} tone={resolveActionFeedbackTone('error', report)} />,
    );

    expect(screen.getByTestId('action-feedback-toast')).toHaveAttribute('data-tone', 'warning');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Partially closed' })).toBeInTheDocument();
    expect(screen.getByText('Close In-Loss Positions')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('Off quotes')).toBeInTheDocument();
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

  it('dismisses from the close button after the exit animation', () => {
    const onDismiss = vi.fn();
    render(<ActionFeedbackToast durationMs={4000} message="Order failed" onDismiss={onDismiss} tone="error" />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByTestId('action-feedback-toast')).toHaveClass('is-exiting');
    act(() => { vi.advanceTimersByTime(160); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
