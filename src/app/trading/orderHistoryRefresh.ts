import { collapseDealHistory, tradeGatewayApi } from '../../api/tradeGateway';
import type { Trade } from '../../store/useAppStore';

export const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
};

const mergeOrderHistory = (parts: Trade[][]): Trade[] => {
  const seen = new Set<string>();
  return parts
    .flat()
    .filter((trade) => {
      const key = `${trade?.type}:${trade?.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Date.parse(b?.closeTime ?? b?.openTime) - Date.parse(a?.closeTime ?? a?.openTime))
    .slice(0, 500);
};

export interface OrderHistoryRefreshResult {
  trades: Trade[];
  warning: string | null;
}

export const fetchOrderHistory = async (login: number): Promise<OrderHistoryRefreshResult> => {
  const [closedPositionsResult, dealsResult] = await Promise.allSettled([
    tradeGatewayApi.getClosedPositions(login),
    tradeGatewayApi.getDeals(login),
  ]);

  if (dealsResult.status === 'rejected') {
    throw new Error(getErrorMessage(dealsResult.reason, 'Deals history endpoint failed'));
  }

  const closedPositions = closedPositionsResult.status === 'fulfilled'
    ? closedPositionsResult.value
    : [];
  const closedDeals = collapseDealHistory(dealsResult.value);

  return {
    trades: mergeOrderHistory([closedDeals.length > 0 ? closedDeals : closedPositions]),
    warning: closedPositionsResult.status === 'rejected'
      ? getErrorMessage(closedPositionsResult.reason, 'Closed-position history endpoint failed')
      : null,
  };
};
