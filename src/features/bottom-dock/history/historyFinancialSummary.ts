import type { Trade } from '../../../store/useAppStore';
import type { HistoryBalanceOperation } from './balanceHistory';

export type HistoryFinancialSummary = {
  profit: number | null;
  credit: number | null;
  deposit: number | null;
  withdrawal: number | null;
  grossProfit: number | null;
  commission: number | null;
  swap: number | null;
  fee: number | null;
};

const MT5_DEAL_TYPES = [
  'buy', 'sell', 'balance', 'credit', 'charge', 'correction', 'bonus',
  'commission', 'commission_daily', 'commission_monthly',
  'commission_agent_daily', 'commission_agent_monthly', 'interest',
  'buy_canceled', 'sell_canceled', 'dividend', 'dividend_franked', 'tax',
] as const;

const operationType = (trade: Trade): string => {
  const value = String(trade.dealType || trade.side || trade.type).trim().toLowerCase()
    .replace(/^deal_(?:type_)?/, '').replace(/[\s-]+/g, '_');
  return /^\d+$/.test(value) ? MT5_DEAL_TYPES[Number(value)] ?? value : value;
};

const amount = (value: number | undefined): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : 0
);

/** Sum execution records once; order and collapsed-position rows are not deals. */
export const calculateHistoryFinancialSummary = (
  deals: readonly Trade[] | null,
  balanceOperations: readonly HistoryBalanceOperation[] | null,
): HistoryFinancialSummary => {
  const totals: HistoryFinancialSummary = {
    profit: deals === null ? null : 0,
    grossProfit: deals === null ? null : 0,
    commission: deals === null ? null : 0,
    swap: deals === null ? null : 0,
    fee: deals === null ? null : 0,
    credit: balanceOperations === null ? null : 0,
    deposit: balanceOperations === null ? null : 0,
    withdrawal: balanceOperations === null ? null : 0,
  };
  const seenTickets = new Set<number>();
  let invalidFinancialRecord = false;
  for (const deal of deals ?? []) {
    if (deal.historySource === 'order' || deal.historySource === 'closed-position') continue;
    const ticket = deal.dealTicket ?? deal.id;
    if (Number.isFinite(ticket) && ticket > 0) {
      if (seenTickets.has(ticket)) continue;
      seenTickets.add(ticket);
    }
    const type = operationType(deal);
    if (['balance', 'deposit', 'withdrawal', 'credit', 'buy_canceled', 'sell_canceled'].includes(type)) continue;
    if (!MT5_DEAL_TYPES.includes(type as typeof MT5_DEAL_TYPES[number])
      || ![deal.profit, deal.commission, deal.swap, deal.fee ?? 0].every(value => typeof value === 'number' && Number.isFinite(value))) {
      invalidFinancialRecord = true;
      continue;
    }
    const profit = amount(deal.profit);
    if (MT5_DEAL_TYPES.includes(type as typeof MT5_DEAL_TYPES[number])
      && type !== 'balance' && type !== 'credit'
      && type !== 'buy_canceled' && type !== 'sell_canceled') {
      // Gateway costs are signed values, including commission on entry deals.
      totals.profit! += profit + amount(deal.commission) + amount(deal.swap) + amount(deal.fee);
      totals.grossProfit! += profit;
      totals.commission! += amount(deal.commission);
      totals.swap! += amount(deal.swap);
      totals.fee! += amount(deal.fee);
    }
  }
  if (invalidFinancialRecord) {
    totals.profit = totals.grossProfit = totals.commission = totals.swap = totals.fee = null;
  }
  const seenOperations = new Set<string>();
  for (const operation of balanceOperations ?? []) {
    if (seenOperations.has(operation.id)) continue;
    seenOperations.add(operation.id);
    if (operation.type === 'credit') totals.credit! += operation.amount;
    else if (operation.amount > 0) totals.deposit! += operation.amount;
    else totals.withdrawal! += operation.amount;
  }
  return totals;
};
