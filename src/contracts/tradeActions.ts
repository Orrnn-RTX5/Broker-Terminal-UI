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
