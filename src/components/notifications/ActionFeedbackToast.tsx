import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import { formatUiMessage, type UiMessage } from '../../utils/uiFeedback';
import { Icon, type IconName } from '../ui/Icon';
import {
  getPositionCloseOutcome,
  type PositionCloseOutcome,
  type PositionCloseReport,
  type PositionCloseReportRow,
} from './positionCloseReport';

export type ActionFeedbackTone = 'success' | 'warning' | 'error';

interface ActionFeedbackToastProps {
  durationMs: number;
  message: UiMessage;
  onDismiss: () => void;
  report?: PositionCloseReport;
  tone: ActionFeedbackTone;
}

const EXIT_ANIMATION_MS = 160;
const MAX_REPORT_ROWS = 4;

const TONE_ICON: Record<ActionFeedbackTone, IconName> = {
  success: 'check-circle',
  warning: 'alert-triangle',
  error: 'error',
};

const OUTCOME_TONE: Record<PositionCloseOutcome, ActionFeedbackTone> = {
  completed: 'success',
  partial: 'warning',
  failed: 'error',
};

/** Reports stay longer than one-line notices, and anything needing attention longer still. */
export const resolveActionFeedbackDurationMs = (
  type: 'success' | 'error',
  report?: PositionCloseReport,
): number => {
  if (report) return getPositionCloseOutcome(report) === 'completed' ? 6000 : 10000;
  return type === 'success' ? 4000 : 7000;
};

export const resolveActionFeedbackTone = (
  type: 'success' | 'error',
  report?: PositionCloseReport,
): ActionFeedbackTone => (report ? OUTCOME_TONE[getPositionCloseOutcome(report)] : type);

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
function useToastLifetime(durationMs: number, onDismiss: () => void) {
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
    schedule();
    return clearTimer;
  }, [clearTimer, schedule]);

  const setHold = useCallback((source: 'hover' | 'focus', held: boolean) => {
    if (exitingRef.current) return;
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
  }, [clearTimer, schedule]);

  return { dismiss, exiting, paused, setHold };
}

function PositionCloseReportBody({ report }: { report: PositionCloseReport }) {
  const tr = useUiTranslation();
  const visibleRows = report.rows.slice(0, MAX_REPORT_ROWS);
  const hiddenCount = report.rows.length - visibleRows.length;

  return (
    <div className="rtx-action-feedback__report">
      <ul className="rtx-action-feedback__rows">
        {visibleRows.map((row) => (
          <PositionCloseReportRowView key={row.ticket} row={row} />
        ))}
      </ul>
      {hiddenCount > 0 && (
        <div className="rtx-action-feedback__more">{tr('+{{hidden}} more', { hidden: hiddenCount })}</div>
      )}

      {report.failureReason && (
        <div className="rtx-action-feedback__reason">
          <Icon name="alert-triangle" size="xs" />
          <span>{report.failureReason}</span>
        </div>
      )}

      {report.closed > 0 && (
        <div className="rtx-action-feedback__total">
          <span className="rtx-action-feedback__total-label">{tr('Est. realized P&L')}</span>
          <span className={`rtx-action-feedback__total-value is-${profitTone(report.realizedProfit)}`}>
            {report.realizedProfit === null ? '—' : formatSigned(report.realizedProfit)}
            {report.realizedProfit !== null && report.currency && (
              <span className="rtx-action-feedback__currency">{report.currency}</span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function PositionCloseReportRowView({ row }: { row: PositionCloseReportRow }) {
  const tr = useUiTranslation();
  const rejected = row.status === 'rejected';

  return (
    <li className={`rtx-action-feedback__row${rejected ? ' is-rejected' : ''}`}>
      <div className="rtx-action-feedback__row-main">
        <span className={`rtx-action-feedback__side is-${row.side.toLowerCase()}`}>{tr(row.side)}</span>
        <span className="rtx-action-feedback__volume">{formatFixed(row.volume, 2)}</span>
        <span className="rtx-action-feedback__symbol">{row.symbol}</span>
        <span className="rtx-action-feedback__row-result">
          {rejected ? (
            <span className="rtx-action-feedback__rejected">{tr('Rejected')}</span>
          ) : (
            <span className={`rtx-action-feedback__pnl is-${profitTone(row.profit)}`}>
              {row.profit === null ? '—' : formatSigned(row.profit)}
            </span>
          )}
        </span>
      </div>
      <div className="rtx-action-feedback__row-detail">
        <span className="rtx-action-feedback__ticket">#{row.ticket}</span>
        <span className="rtx-action-feedback__prices">
          <span title={tr('Open Price')}>{formatFixed(row.openPrice, row.digits)}</span>
          {!rejected && row.closePrice !== null && (
            <>
              <span className="rtx-action-feedback__arrow" aria-hidden="true">→</span>
              <span title={tr('Close Price')}>{formatFixed(row.closePrice, row.digits)}</span>
            </>
          )}
        </span>
      </div>
    </li>
  );
}

/**
 * Non-blocking feedback for user-initiated terminal actions.
 * The neutral elevated surface keeps chart data legible; semantic color is
 * reserved for the state icon, status, edge, P&L, and lifetime indicator.
 */
export function ActionFeedbackToast({
  durationMs,
  message,
  onDismiss,
  report,
  tone,
}: ActionFeedbackToastProps) {
  const tr = useUiTranslation();
  const [shownAt] = useState(() => Date.now());
  const { dismiss, exiting, paused, setHold } = useToastLifetime(durationMs, onDismiss);

  const outcome = report ? getPositionCloseOutcome(report) : null;
  const statusLabel = outcome === 'partial'
    ? tr('Partial')
    : tone === 'error' ? tr('Failed') : tr('Completed');

  const scopeLabel = report?.scope === 'WINNERS'
    ? tr('Close In-Profit Positions')
    : report?.scope === 'LOSERS'
      ? tr('Close In-Loss Positions')
      : tr('Close All Positions');

  const reportTitle = outcome === 'failed'
    ? tr('Close failed')
    : outcome === 'partial'
      ? tr('Partially closed')
      : report && report.closed === 1 ? tr('Position closed') : tr('Positions closed');

  const className = [
    'rtx-action-feedback',
    `rtx-action-feedback--${tone}`,
    report ? 'rtx-action-feedback--report' : '',
    exiting ? 'is-exiting' : '',
    paused ? 'is-paused' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="rtx-action-feedback-region">
      <section
        aria-atomic="true"
        aria-live={tone === 'success' ? 'polite' : 'assertive'}
        className={className}
        data-testid="action-feedback-toast"
        data-tone={tone}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHold('focus', false);
        }}
        onFocus={() => setHold('focus', true)}
        onMouseEnter={() => setHold('hover', true)}
        onMouseLeave={() => setHold('hover', false)}
        role={tone === 'success' ? 'status' : 'alert'}
        style={{ '--rtx-action-feedback-duration': `${durationMs}ms` } as React.CSSProperties}
      >
        <div className="rtx-action-feedback__icon" aria-hidden="true">
          <Icon name={TONE_ICON[tone]} size="md" />
        </div>

        <div className="rtx-action-feedback__content">
          <div className="rtx-action-feedback__meta">
            {report ? (
              <>
                <span className="rtx-action-feedback__context">{scopeLabel}</span>
                {report.symbol && <span className="rtx-action-feedback__symbol-tag">{report.symbol}</span>}
              </>
            ) : (
              <span className="rtx-action-feedback__status">{statusLabel}</span>
            )}
            <time className="rtx-action-feedback__time" dateTime={new Date(report?.completedAt ?? shownAt).toISOString()}>
              {formatClockTime(report?.completedAt ?? shownAt)}
            </time>
          </div>

          {report ? (
            <>
              <div className="rtx-action-feedback__title-row">
                <h2 className="rtx-action-feedback__title">{reportTitle}</h2>
                <span className="rtx-action-feedback__status-pill">{statusLabel}</span>
              </div>
              <p className="rtx-action-feedback__message">
                {tr('{{closed}} of {{total}} closed at market', { closed: report.closed, total: report.requested })}
              </p>
            </>
          ) : (
            <p className="rtx-action-feedback__title">{formatUiMessage(message, tr)}</p>
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

        {report && <PositionCloseReportBody report={report} />}

        <span className="rtx-action-feedback__lifetime" aria-hidden="true" />
      </section>
    </div>
  );
}
