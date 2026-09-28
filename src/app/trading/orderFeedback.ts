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

export const publishOrderFeedback = (
  message: UiMessage,
  type: OrderFeedbackDetail['type'] = 'error',
  report?: PositionCloseReport,
): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<OrderFeedbackDetail>(ORDER_FEEDBACK_EVENT, {
    detail: {
      message: formatUiMessage(message),
      messageParts: typeof message === 'string' ? [feedbackLabel(message)] : message,
      type,
      report,
    },
  }));
};
