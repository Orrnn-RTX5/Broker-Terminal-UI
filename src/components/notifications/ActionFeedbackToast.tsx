import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import { formatUiMessage, type UiMessage } from '../../utils/uiFeedback';
import { Icon, type IconName } from '../ui/Icon';
import type { MarketWatchExportResult } from '../../utils/marketWatchExport';
import { MarketWatchExportSheet } from './MarketWatchExportSheet';
import {
  getPositionCloseOutcome,
  type PositionCloseReport,
  type PositionCloseReportRow,
} from './positionCloseReport';

export type ActionFeedbackTone = 'success' | 'warning' | 'error' | 'loss';
export type ActionFeedbackType = 'success' | 'error';

export interface ActionFeedbackNotice {
  /** Short action or workspace name, used as the notice heading. */
  title: UiMessage;
  /** Human-readable result summary shown below the heading. */
  description?: UiMessage;
  /** Compact outcome/destination label, for example "Copied" or "CSV". */
  meta?: UiMessage;
  /** Label paired with meta when the notice needs to identify a destination. */
  metaLabel?: UiMessage;
  metaIcon?: IconName;
  /** Brief next step or clarification shown below the destination. */
  hint?: UiMessage;
  /** Captured export data for the persistent result sheet and CSV action. */
  exportResult?: MarketWatchExportResult;
}

interface ActionFeedbackToastProps {
  durationMs: number;
  message: UiMessage;
  notice?: ActionFeedbackNotice;
  onDismiss: () => void;
  report?: PositionCloseReport;
  tone: ActionFeedbackTone;
}

const EXIT_ANIMATION_MS = 160;
const CLOSE_RECEIPT_TOTAL_LIFETIME_MS = 1000;
const MAX_REPORT_ROWS = 4;

const TONE_ICON: Record<ActionFeedbackTone, IconName> = {
  success: 'check-circle',
  loss: 'trending-down',
  warning: 'alert-triangle',
  error: 'error',
};

/** Action feedback and close receipts share a strict one-second mount-to-dismiss lifetime. */
export const resolveActionFeedbackDurationMs = (
  _type: ActionFeedbackType,
  _report?: PositionCloseReport,
): number => CLOSE_RECEIPT_TOTAL_LIFETIME_MS;

export const resolveActionFeedbackTone = (
  type: ActionFeedbackType,
  report?: PositionCloseReport,
): ActionFeedbackTone => {
  if (!report) return type;
  const outcome = getPositionCloseOutcome(report);
  if (outcome === 'failed') return 'error';
  if (outcome === 'partial') return 'warning';
  // A completed close is colored by its result; an unknown result falls back to the scope.
  if (report.realizedProfit !== null) return report.realizedProfit < 0 ? 'loss' : 'success';
  return report.scope === 'LOSERS' ? 'loss' : 'success';
};

const formatFixed = (value: number, digits: number): string => value.toLocaleString('en-US', {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
});

const formatSigned = (value: number): string => `${value > 0 ? '+' : value < 0 ? '-' : ''}${formatFixed(Math.abs(value), 2)}`;

const profitTone = (value: number | null): 'profit' | 'loss' | 'neutral' => {
  if (value === null || value === 0) return 'neutral';
  return value > 0 ? 'profit' : 'loss';
};

const formatClockTime = (timestamp: number): string => new Date(timestamp).toLocaleTimeString('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/**
 * Keeps the toast alive while the trader is reading or tabbing through it.
 * Returns hold handlers plus the paused/exiting flags that drive the CSS.
 */
function useToastLifetime(durationMs: number, onDismiss: () => void, autoDismiss = true) {
  const [exiting, setExiting] = useState(false);
  const [paused, setPaused] = useState(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const timerRef = useRef<number | null>(null);
  const remainingRef = useRef(durationMs);
  const startedAtRef = useRef(0);
  const exitingRef = useRef(false);
  const holdRef = useRef({ hover: false, focus: false });

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const dismiss = useCallback(() => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    clearTimer();
    setExiting(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      onDismissRef.current();
    }, EXIT_ANIMATION_MS);
  }, [clearTimer]);

  const schedule = useCallback(() => {
    clearTimer();
    startedAtRef.current = Date.now();
    timerRef.current = window.setTimeout(dismiss, Math.max(0, remainingRef.current));
  }, [clearTimer, dismiss]);

  useEffect(() => {
    if (autoDismiss) schedule();
    return clearTimer;
  }, [autoDismiss, clearTimer, schedule]);

  const setHold = useCallback((source: 'hover' | 'focus', held: boolean) => {
    if (!autoDismiss || exitingRef.current) return;
    const wasHeld = holdRef.current.hover || holdRef.current.focus;
    holdRef.current[source] = held;
    const isHeld = holdRef.current.hover || holdRef.current.focus;
    if (isHeld === wasHeld) return;
    if (isHeld) {
      clearTimer();
      remainingRef.current -= Date.now() - startedAtRef.current;
    } else {
      schedule();
    }
    setPaused(isHeld);
  }, [autoDismiss, clearTimer, schedule]);

  return { dismiss, exiting, paused, setHold };
}

function PositionCloseTable({ rows }: { rows: PositionCloseReportRow[] }) {
  const tr = useUiTranslation();
  const [expanded, setExpanded] = useState(false);
  const visibleRows = expanded ? rows : rows.slice(0, MAX_REPORT_ROWS);
  const hiddenCount = rows.length - Math.min(rows.length, MAX_REPORT_ROWS);
  // One symbol goes in the header; a mixed close names the symbol per row.
  const mixedSymbols = new Set(rows.map(row => row.symbol)).size > 1;

  return (
    <>
      <div className={`rtx-action-feedback__table-wrap${expanded ? ' is-expanded' : ''}`}>
        <table className="rtx-action-feedback__table">
          <thead>
            <tr>
              <th scope="col">{tr('Type')}</th>
              <th scope="col">{mixedSymbols ? tr('Symbol') : tr('Ticket')}</th>
              <th scope="col" className="is-num">{tr('Volume')}</th>
              <th scope="col" className="is-num">{tr('Open')}</th>
              <th scope="col" className="is-num">{tr('Close')}</th>
              <th scope="col" className="is-num">{tr('P&L')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const rejected = row.status === 'rejected';
              return (
                <tr key={row.ticket} className={rejected ? 'is-rejected' : undefined}>
                  <td><span className={`rtx-action-feedback__side is-${row.side.toLowerCase()}`}>{tr(row.side)}</span></td>
                  <td className="rtx-action-feedback__ticket">
                    {mixedSymbols && <span className="rtx-action-feedback__row-symbol">{row.symbol}</span>}
                    <span>#{row.ticket}</span>
                  </td>
                  <td className="is-num">{formatFixed(row.volume, 2)}</td>
                  <td className="is-num is-muted" title={tr('Open Price')}>{formatFixed(row.openPrice, row.digits)}</td>
                  <td className="is-num" title={tr('Close Price')}>
                    {!rejected && row.closePrice !== null ? formatFixed(row.closePrice, row.digits) : '—'}
                  </td>
                  <td className="is-num">
                    {rejected ? (
                      <span className="rtx-action-feedback__rejected">{tr('Rejected')}</span>
                    ) : (
                      <span className={`rtx-action-feedback__pnl is-${profitTone(row.profit)}`}>
                        {row.profit === null ? '—' : formatSigned(row.profit)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hiddenCount > 0 && (
        <button
          aria-expanded={expanded}
          className="rtx-action-feedback__more"
          onClick={() => setExpanded(value => !value)}
          type="button"
        >
          <span>{expanded ? tr('Hide') : tr('+{{hidden}} more', { hidden: hiddenCount })}</span>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size="xs" />
        </button>
      )}
    </>
  );
}

function PositionCloseDetails({ row }: { row: PositionCloseReportRow }) {
  const tr = useUiTranslation();
  const rejected = row.status === 'rejected';

  return (
    <dl className="rtx-action-feedback__details">
      <div>
        <dt>{tr('Ticket')}</dt>
        <dd>#{row.ticket}</dd>
      </div>
      <div>
        <dt>{tr('Type')}</dt>
        <dd><span className={`rtx-action-feedback__side is-${row.side.toLowerCase()}`}>{tr(row.side)}</span></dd>
      </div>
      <div>
        <dt>{tr('Volume')}</dt>
        <dd>{formatFixed(row.volume, 2)}<span className="rtx-action-feedback__unit">{tr('Lots')}</span></dd>
      </div>
      <div>
        <dt>{tr('Open Price')}</dt>
        <dd>{formatFixed(row.openPrice, row.digits)}</dd>
      </div>
      <div>
        <dt>{tr('Close Price')}</dt>
        <dd>{rejected ? <span className="rtx-action-feedback__rejected">{tr('Rejected')}</span> : row.closePrice !== null ? formatFixed(row.closePrice, row.digits) : '—'}</dd>
      </div>
    </dl>
  );
}

/**
 * Centered execution receipt for a bulk position close. It opens once the
 * broker has answered, closes within one second, and can be dismissed sooner
 * with Esc, the close button, or the backdrop.
 */
function PositionCloseReceipt({
  durationMs,
  onDismiss,
  report,
  tone,
}: Omit<ActionFeedbackToastProps, 'message' | 'report'> & { report: PositionCloseReport }) {
  const tr = useUiTranslation();
  const titleId = useId();
  const summaryId = useId();
  // durationMs is the total visibility budget. Begin the fade early enough for
  // the existing exit animation and final unmount to finish inside that budget,
  // and cap legacy/direct callers so a receipt can never exceed one second.
  const { dismiss, exiting } = useToastLifetime(
    Math.max(0, Math.min(durationMs, CLOSE_RECEIPT_TOTAL_LIFETIME_MS) - EXIT_ANIMATION_MS),
    onDismiss,
  );
  const dismissRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Esc belongs to the topmost layer, so it closes the receipt and stops there.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [dismiss]);

  // A modal always owns focus while open. Restore the trader's prior target
  // after acknowledgement so keyboard workflows continue where they started.
  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    dismissRef.current?.focus({ preventScroll: true });
    return () => {
      if (previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus({ preventScroll: true });
      }
    };
  }, []);

  const trapFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)'));
    if (focusable.length === 0) return;
    const edge = event.shiftKey ? focusable[0] : focusable[focusable.length - 1];
    if (document.activeElement !== edge) return;
    event.preventDefault();
    (event.shiftKey ? focusable[focusable.length - 1] : focusable[0]).focus();
  };

  const outcome = getPositionCloseOutcome(report);
  const hasPnl = report.closed > 0 && report.realizedProfit !== null;
  const pnlTone = profitTone(hasPnl ? report.realizedProfit : null);
  const single = report.rows.length === 1;
  const breakeven = outcome === 'completed' && hasPnl && pnlTone === 'neutral';
  const closedVolume = report.rows.reduce((sum, row) => (row.status === 'closed' ? sum + row.volume : sum), 0);

  const title = outcome === 'failed'
    ? tr('Close failed')
    : outcome === 'partial'
      ? tr('Partially closed')
      : report.closed === 1 ? tr('Position closed') : tr('Positions closed');

  const statusLabel = outcome === 'failed'
    ? tr('Failed')
    : outcome === 'partial'
      ? tr('Partial')
      : !hasPnl
        ? tr('Completed')
        : pnlTone === 'profit' ? tr('Profit') : pnlTone === 'loss' ? tr('Loss') : tr('Breakeven');

  const iconName: IconName = outcome !== 'completed' || !hasPnl
    ? TONE_ICON[tone]
    : pnlTone === 'profit' ? 'trending-up' : pnlTone === 'loss' ? 'trending-down' : 'check-circle';

  const scopeLabel = report.scope === 'WINNERS'
    ? tr('Close In-Profit Positions')
    : report.scope === 'LOSERS'
      ? tr('Close In-Loss Positions')
      : report.scope === 'ALL' ? tr('Close All Positions') : null;

  const className = [
    'rtx-action-feedback',
    'rtx-action-feedback--report',
    `rtx-action-feedback--${tone}`,
    breakeven ? 'rtx-action-feedback--breakeven' : '',
    single ? 'rtx-action-feedback--single' : '',
    exiting ? 'is-exiting' : '',
  ].filter(Boolean).join(' ');

  return (
    <>
      <div
        aria-hidden="true"
        className={`rtx-action-feedback-backdrop${exiting ? ' is-exiting' : ''}`}
        onClick={dismiss}
      />
      <div className="rtx-action-feedback-region rtx-action-feedback-region--center">
        <section
          aria-describedby={summaryId}
          aria-labelledby={titleId}
          aria-modal="true"
          className={className}
          data-testid="action-feedback-toast"
          data-tone={tone}
          onKeyDown={trapFocus}
          role="dialog"
        >
          <header className="rtx-action-feedback__header">
            <span className="rtx-action-feedback__icon" aria-hidden="true">
              <Icon name={iconName} size="md" />
            </span>
            <div className="rtx-action-feedback__heading">
              <div className="rtx-action-feedback__title-row">
                <h2 className="rtx-action-feedback__title" id={titleId}>{title}</h2>
                <span className="rtx-action-feedback__status-pill">{statusLabel}</span>
              </div>
              <p className="rtx-action-feedback__subtitle">
                {report.symbol && <span className="rtx-action-feedback__symbol-tag">{report.symbol}</span>}
                {scopeLabel && <span>{scopeLabel}</span>}
                <time dateTime={new Date(report.completedAt).toISOString()}>{formatClockTime(report.completedAt)}</time>
              </p>
            </div>
            <button
              aria-label={tr('Dismiss')}
              className="rtx-action-feedback__dismiss"
              onClick={dismiss}
              ref={dismissRef}
              title={tr('Dismiss')}
              type="button"
            >
              <Icon name="x-close" size="sm" />
            </button>
          </header>

          <div className="rtx-action-feedback__summary" id={summaryId}>
            <div className="rtx-action-feedback__stat">
              <span className="rtx-action-feedback__stat-label">{tr('Est. realized P&L')}</span>
              <span className={`rtx-action-feedback__pnl-value is-${pnlTone}`}>
                {hasPnl ? formatSigned(report.realizedProfit as number) : '—'}
                {hasPnl && report.currency && <span className="rtx-action-feedback__unit">{report.currency}</span>}
              </span>
            </div>
            {!single && (
              <div className="rtx-action-feedback__stat rtx-action-feedback__stat--end">
                <span className="rtx-action-feedback__stat-label">{tr('Volume')}</span>
                <span className="rtx-action-feedback__stat-value">
                  {formatFixed(closedVolume, 2)}<span className="rtx-action-feedback__unit">{tr('Lots')}</span>
                </span>
              </div>
            )}
          </div>

          <div className="rtx-action-feedback__body">
            {single ? <PositionCloseDetails row={report.rows[0]} /> : <PositionCloseTable rows={report.rows} />}

            {report.failureReason && (
              <div className="rtx-action-feedback__reason" role="alert">
                <Icon name="alert-triangle" size="sm" />
                <span>{report.failureReason}</span>
              </div>
            )}
          </div>

          <footer className="rtx-action-feedback__footer">
            <span className="rtx-action-feedback__footnote">
              {tr('{{closed}} of {{total}} closed at market', { closed: report.closed, total: report.requested })}
            </span>
          </footer>

        </section>
      </div>
    </>
  );
}

/**
 * Feedback for user-initiated terminal actions. One-line notices stay at the
 * edge and never block; a position-close report opens as a centered receipt.
 */
export function ActionFeedbackToast({
  durationMs,
  message,
  notice,
  onDismiss,
  report,
  tone,
}: ActionFeedbackToastProps) {
  if (notice?.exportResult) {
    return <MarketWatchExportSheet result={notice.exportResult} onDismiss={onDismiss} />;
  }
  if (report) {
    const receipt = <PositionCloseReceipt durationMs={durationMs} onDismiss={onDismiss} report={report} tone={tone} />;
    return typeof document === 'undefined' ? receipt : createPortal(receipt, document.body);
  }
  const compactToast = <CompactToast durationMs={durationMs} message={message} notice={notice} onDismiss={onDismiss} tone={tone} />;
  // Structured action results belong at the visual center and must not inherit
  // a transformed application ancestor as their fixed-position containing box.
  return notice && typeof document !== 'undefined'
    ? createPortal(compactToast, document.body)
    : compactToast;
}

function CompactToast({ durationMs, message, notice, onDismiss, tone }: Omit<ActionFeedbackToastProps, 'report'>) {
  const tr = useUiTranslation();
  const [shownAt] = useState(() => Date.now());
  const isStrictOneSecondBudget = durationMs <= CLOSE_RECEIPT_TOTAL_LIFETIME_MS;
  const activeDurationMs = isStrictOneSecondBudget
    ? Math.max(0, durationMs - EXIT_ANIMATION_MS)
    : durationMs;
  const { dismiss, exiting, paused, setHold } = useToastLifetime(activeDurationMs, onDismiss);

  const className = [
    'rtx-action-feedback',
    `rtx-action-feedback--${tone}`,
    exiting ? 'is-exiting' : '',
    paused ? 'is-paused' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={`rtx-action-feedback-region${notice ? ' rtx-action-feedback-region--notice-center' : ''}`}>
      <section
        aria-atomic="true"
        aria-live={tone === 'success' ? 'polite' : 'assertive'}
        className={className}
        data-testid="action-feedback-toast"
        data-tone={tone}
        onBlur={isStrictOneSecondBudget ? undefined : (event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHold('focus', false);
        }}
        onFocus={isStrictOneSecondBudget ? undefined : () => setHold('focus', true)}
        onMouseEnter={isStrictOneSecondBudget ? undefined : () => setHold('hover', true)}
        onMouseLeave={isStrictOneSecondBudget ? undefined : () => setHold('hover', false)}
        role={tone === 'success' ? 'status' : 'alert'}
        style={{ '--rtx-action-feedback-duration': `${activeDurationMs}ms` } as React.CSSProperties}
      >
        <div className="rtx-action-feedback__icon" aria-hidden="true">
          <Icon name={TONE_ICON[tone]} size="md" />
        </div>

        <div className="rtx-action-feedback__content">
          <div className="rtx-action-feedback__meta">
            <span className="rtx-action-feedback__status">{tone === 'success' ? tr('Completed') : tr('Failed')}</span>
            <time className="rtx-action-feedback__time" dateTime={new Date(shownAt).toISOString()}>
              {formatClockTime(shownAt)}
            </time>
          </div>
          <div aria-level={2} className="rtx-action-feedback__title" role="heading">
            {formatUiMessage(notice?.title ?? message, tr)}
          </div>
          {notice?.description && (
            <p className="rtx-action-feedback__description">{formatUiMessage(notice.description, tr)}</p>
          )}
          {notice?.meta && (
            <div className={`rtx-action-feedback__channel${notice.metaLabel ? ' is-destination' : ''}`}>
              {notice.metaLabel && (
                <span className="rtx-action-feedback__channel-label">
                  {formatUiMessage(notice.metaLabel, tr)}
                </span>
              )}
              <span className="rtx-action-feedback__channel-value">
                {notice.metaIcon && <span aria-hidden="true"><Icon name={notice.metaIcon} size="xs" /></span>}
                <span>{formatUiMessage(notice.meta, tr)}</span>
              </span>
            </div>
          )}
          {notice?.hint && (
            <p className="rtx-action-feedback__hint">{formatUiMessage(notice.hint, tr)}</p>
          )}
        </div>

        <button
          aria-label={tr('Dismiss')}
          className="rtx-action-feedback__dismiss"
          onClick={dismiss}
          title={tr('Dismiss')}
          type="button"
        >
          <Icon name="x-close" size="sm" />
        </button>

        <span className="rtx-action-feedback__lifetime" aria-hidden="true" />
      </section>
    </div>
  );
}
