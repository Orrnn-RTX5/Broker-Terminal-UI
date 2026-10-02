import { describe, expect, it } from 'vitest';
import type { Trade } from '../../../store/useAppStore';
import { calculateHistoryFinancialSummary } from './historyFinancialSummary';

const deal = (id: number, patch: Partial<Trade> = {}): Trade => ({
  id, dealTicket: id, symbol: 'XAUUSD', type: 'entry_out', side: 'buy',
  historySource: 'deal', volume: 0.01, openPrice: 4188.18,
  openTime: '2026-10-01T08:41:12Z', profit: 0, commission: 0, swap: 0, ...patch,
});

describe('MT5 history financial summary', () => {
  it('recognizes backend deal_buy and deal_sell actions when summing signed execution amounts', () => {
    expect(calculateHistoryFinancialSummary([
      deal(1, { dealType: 'deal_buy', profit: 10, commission: -1 }),
      deal(2, { dealType: 'deal_sell', profit: -5, swap: -0.5 }),
      deal(3, { dealType: 'deal_balance', profit: 20_000 }),
    ], [])).toMatchObject({ profit: 3.5, grossProfit: 5, commission: -1, swap: -0.5 });
  });

  it('includes entry costs and separate charges once, excluding orders, cash deals and position fallbacks', () => {
    const entry = deal(1, { type: 'entry_in', dealType: '0', commission: -2 });
    const exit = deal(2, { dealType: 'DEAL_TYPE_SELL', profit: 20, swap: -3, fee: -0.5 });
    expect(calculateHistoryFinancialSummary([
      entry, exit, exit,
      deal(3, { dealType: 'commission_daily', profit: -1 }),
      deal(4, { dealType: 'balance', profit: 10_000 }),
      deal(5, { dealType: 'credit', profit: 50 }),
      deal(6, { dealType: 'buy_canceled', profit: 20 }),
      deal(7, { historySource: 'order', profit: 20 }),
      deal(8, { historySource: 'closed-position', profit: 20 }),
    ], [
      { id: 'deposit', type: 'deposit', amount: 10_000, time: null },
      { id: 'deposit', type: 'deposit', amount: 10_000, time: null },
      { id: 'withdraw', type: 'withdrawal', amount: -250, time: null },
      { id: 'credit', type: 'credit', amount: 50, time: null },
      { id: 'credit-reversal', type: 'credit', amount: -10, time: null },
    ])).toEqual({
      profit: 13.5, grossProfit: 19, commission: -2, swap: -3, fee: -0.5,
      deposit: 10_000, withdrawal: -250, credit: 40,
    });
  });

  it('distinguishes a confirmed empty source from an unavailable source independently', () => {
    expect(calculateHistoryFinancialSummary([], [])).toEqual({
      profit: 0, grossProfit: 0, commission: 0, swap: 0, fee: 0, credit: 0, deposit: 0, withdrawal: 0,
    });
    expect(calculateHistoryFinancialSummary(null, [])).toMatchObject({ profit: null, deposit: 0, credit: 0 });
    expect(calculateHistoryFinancialSummary([deal(1, { profit: -5 })], null))
      .toMatchObject({ profit: -5, deposit: null, withdrawal: null, credit: null });
  });

  it('does not present malformed financial records as a zero result', () => {
    expect(calculateHistoryFinancialSummary([deal(1, { profit: NaN }), deal(2, { profit: 100 })], []))
      .toMatchObject({ profit: null, grossProfit: null, deposit: 0 });
    expect(calculateHistoryFinancialSummary([deal(1, { dealType: 'unknown_operation' })], []))
      .toMatchObject({ profit: null });
  });
});
