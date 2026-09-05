export const MARKET_ORDER_PLACEMENT_STATE_EVENT = 'rtx:market-order-placement-state';

export type MarketOrderPlacementState =
  | 'pending'
  | 'accepted'
  | 'processing'
  | 'filled'
  | 'rejected'
  | 'expired'
  | 'confirmed'
  | 'failed';

export type MarketOrderPlacementStateDetail = {
  status: MarketOrderPlacementState;
  clientOrderId: string;
  login: number;
  sessionScope: string;
  provisionalTicket: number;
  position?: unknown;
  errorCode?: string;
  errorMessage?: string;
};
