export type TradeOperationContext = {
  sessionScope: string;
  login: number;
  authGeneration: number;
};

export const createTradeOperationContext = (
  sessionScope: string,
  login: number,
  authGeneration: number,
): TradeOperationContext => ({ sessionScope, login, authGeneration });

export const isSameTradeOperationContext = (
  expected: TradeOperationContext,
  current: TradeOperationContext | null,
): boolean => Boolean(
  current
  && expected.sessionScope === current.sessionScope
  && expected.login === current.login
  && expected.authGeneration === current.authGeneration
);

export const createSessionScopedTicketKey = (
  sessionScope: string,
  ticket: number,
): string => `${sessionScope}::${ticket}`;

export const commitIfCurrentTradeOperation = (
  expected: TradeOperationContext,
  getCurrent: () => TradeOperationContext | null,
  commit: () => void,
): boolean => {
  if (!isSameTradeOperationContext(expected, getCurrent())) return false;
  commit();
  return true;
};
