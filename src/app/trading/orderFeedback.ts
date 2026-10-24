import type { ActionFeedbackNotice, ActionFeedbackType } from '../../components/notifications/ActionFeedbackToast';
import type { PositionCloseReport } from '../../components/notifications/positionCloseReport';
import { ORDER_FEEDBACK_EVENT } from '../../contracts/terminalEvents';
import { feedbackLabel, formatUiMessage, type UiMessage, type UiMessagePart } from '../../utils/uiFeedback';

export interface OrderFeedbackDetail {
  message: string;
  messageParts?: UiMessagePart[];
  type: ActionFeedbackType;
  notice?: ActionFeedbackNotice;
  report?: PositionCloseReport;
}

export interface OrderFeedbackOptions {
  title?: UiMessage;
  description?: UiMessage;
  meta?: UiMessage;
  metaLabel?: UiMessage;
  metaIcon?: ActionFeedbackNotice['metaIcon'];
  hint?: UiMessage;
  report?: PositionCloseReport;
}

export const publishOrderFeedback = (
  message: UiMessage,
  type: OrderFeedbackDetail['type'] = 'error',
  reportOrOptions?: PositionCloseReport | OrderFeedbackOptions,
): void => {
  if (typeof window === 'undefined') return;
  const isReport = Boolean(
    reportOrOptions
    && typeof reportOrOptions === 'object'
    && 'scope' in reportOrOptions
    && 'closedCount' in reportOrOptions,
  );
  const report = isReport
    ? (reportOrOptions as PositionCloseReport)
    : (reportOrOptions as OrderFeedbackOptions | undefined)?.report;
  const opts = !isReport ? (reportOrOptions as OrderFeedbackOptions | undefined) : undefined;
  const notice: ActionFeedbackNotice | undefined = opts?.title
    ? {
        title: opts.title,
        description: opts.description ?? message,
        meta: opts.meta,
        metaLabel: opts.metaLabel,
        metaIcon: opts.metaIcon,
        hint: opts.hint,
      }
    : undefined;

  window.dispatchEvent(new CustomEvent<OrderFeedbackDetail>(ORDER_FEEDBACK_EVENT, {
    detail: {
      message: formatUiMessage(message),
      messageParts: typeof message === 'string' ? [feedbackLabel(message)] : message,
      type,
      ...(notice ? { notice } : {}),
      report,
    },
  }));
};
