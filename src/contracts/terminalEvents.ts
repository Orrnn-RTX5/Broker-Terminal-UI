export const TRADE_MODIFIED_EVENT = 'rtx:trade-modified' as const;
export const TRADE_HISTORY_REFRESH_COMPLETED_EVENT = 'rtx:trade-history-refresh-completed' as const;
export const ORDER_FEEDBACK_EVENT = 'rtx:order-feedback' as const;

export type TradeModifiedEventDetail = {
  id?: unknown;
  symbol?: unknown;
  sl?: unknown;
  tp?: unknown;
  comment?: unknown;
  sessionScope?: unknown;
};

export type TradeHistoryRefreshCompletedEventDetail = {
  login?: number;
  ok?: boolean;
  message?: string | null;
};
