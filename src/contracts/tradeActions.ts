export type BulkCloseMode = 'ALL' | 'WINNERS' | 'LOSERS';

export type ClosePositionAction = (
  ticket: number,
  volume?: number,
) => Promise<boolean> | boolean | void;

export type ModifyPositionAction = (
  ticket: number,
  stopLoss: number,
  takeProfit: number,
) => Promise<void> | void;

export type CancelOrderAction = (orderId: string | number) => Promise<void> | void;

// Bulk pending cancel with ONE confirm owned by the handler (SUI-T5). The
// handler confirms once up front, cancels sequentially with per-ticket
// idempotency keys, and rethrows failures.
export type BulkCancelOrdersAction = (tickets: Array<string | number>) => Promise<void> | void;

// Single pending cancel WITHOUT confirmation (SUI-T5 fallback path: the bulk
// loop must never route through the confirming single path).
export type CancelOrderWithoutConfirmAction = (orderId: string | number) => Promise<void> | void;

export type CloseBulkPositionsAction = (
  mode: BulkCloseMode,
  symbol?: string,
) => Promise<void> | void;

export interface TradeActions {
  closePosition: ClosePositionAction;
  modifyPosition: ModifyPositionAction;
  cancelOrder: CancelOrderAction;
  closeBulk: CloseBulkPositionsAction;
}
