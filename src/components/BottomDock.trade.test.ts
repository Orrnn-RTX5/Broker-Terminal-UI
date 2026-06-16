import { describe, expect, it } from 'vitest';

import {
  canUseProfitForAccountReconciliation,
  calculateLivePositionProfit,
  resolveTradeAccountMetrics,
  resolveTradeProfit,
} from './BottomDock.trade';

describe('BottomDock trade helpers', () => {
  it('calculates forex profit using standard lot contract size', () => {
    expect(calculateLivePositionProfit({
      symbol: 'GBPUSD',
      side: 'BUY',
      volume: 0.01,
      openPrice: 1.33981,
      currentPrice: 1.34142,
    })).toBeCloseTo(1.61, 5);
  });

  it('does not apply forex contract size to crypto symbols', () => {
    expect(calculateLivePositionProfit({
      symbol: 'BTCUSD',
      side: 'BUY',
      volume: 0.01,
      openPrice: 66294.16,
      currentPrice: 66299.70,
    })).toBeCloseTo(0.0554, 5);
  });

  it('uses explicit broker contract size when a position provides one', () => {
    expect(calculateLivePositionProfit({
      symbol: 'BTCUSD',
      side: 'BUY',
      volume: 0.01,
      openPrice: 66294.16,
      currentPrice: 66299.70,
      contract_size: 100,
    })).toBeCloseTo(5.54, 5);
  });

  it('inverts price movement for sell positions', () => {
    expect(calculateLivePositionProfit({
      symbol: 'EURUSD',
      side: 'SELL',
      volume: 0.02,
      openPrice: 1.1000,
      currentPrice: 1.0990,
    })).toBeCloseTo(2, 5);
  });

  it('uses backend profit as the authoritative MT-style value when it is present', () => {
    expect(resolveTradeProfit({
      symbol: 'BTCUSD',
      side: 'BUY',
      volume: 0.01,
      openPrice: 66294.16,
      currentPrice: 66299.70,
      profit: 5540,
      hasBackendProfit: true,
    })).toMatchObject({
      value: 5540,
      source: 'backend',
      warnings: expect.arrayContaining(['missing_contract_size', 'missing_profit_currency']),
    });
  });

  it('calculates live profit only when backend profit is missing', () => {
    expect(resolveTradeProfit({
      symbol: 'BTCUSD',
      side: 'BUY',
      volume: 0.01,
      openPrice: 66294.16,
      currentPrice: 66299.70,
      contract_size: 1,
      hasBackendProfit: false,
    })).toMatchObject({
      value: expect.closeTo(0.0554, 5),
      source: 'calculated',
    });
  });

  it('flags account-currency conversion when profit currency differs from account currency', () => {
    const resolved = resolveTradeProfit({
      symbol: 'EURGBP',
      side: 'BUY',
      volume: 0.01,
      openPrice: 0.8500,
      currentPrice: 0.8510,
      contract_size: 100000,
      currency_profit: 'GBP',
      hasBackendProfit: false,
    }, {
      accountCurrency: 'USD',
    });

    expect(resolved).toMatchObject({
      value: 0,
      source: 'missing',
      warnings: expect.arrayContaining(['requires_profit_currency_conversion']),
    });
  });

  it('allows account reconciliation only from backend or explicit-contract calculated profit', () => {
    expect(canUseProfitForAccountReconciliation('backend')).toBe(true);
    expect(canUseProfitForAccountReconciliation('calculated')).toBe(true);
    expect(canUseProfitForAccountReconciliation('estimated')).toBe(false);
    expect(canUseProfitForAccountReconciliation('missing')).toBe(false);
    expect(canUseProfitForAccountReconciliation(undefined)).toBe(false);
  });

  it('keeps coherent backend account metrics authoritative', () => {
    const resolved = resolveTradeAccountMetrics({
      balance: 1000,
      equity: 1010,
      margin: 100,
      freeMargin: 910,
      marginLevel: 1010,
    }, {
      floatingProfit: 10,
      canReconcileEquity: true,
    });

    expect(resolved).toMatchObject({
      equity: 1010,
      freeMargin: 910,
      marginLevel: 1010,
      equitySource: 'backend',
      freeMarginSource: 'backend',
      marginLevelSource: 'backend',
      warnings: [],
    });
  });

  it('falls back to calculated equity when backend equity does not reconcile with visible positions', () => {
    const resolved = resolveTradeAccountMetrics({
      balance: 999998.56,
      equity: 1023501.78,
      margin: 30,
      freeMargin: 1023471.78,
      marginLevel: 3411672.6,
    }, {
      floatingProfit: 5543.22,
      canReconcileEquity: true,
    });

    expect(resolved.equity).toBeCloseTo(1005541.78, 5);
    expect(resolved.freeMargin).toBeCloseTo(1005511.78, 5);
    expect(resolved.marginLevel).toBeCloseTo(3351805.933333, 5);
    expect(resolved).toMatchObject({
      equitySource: 'calculated',
      freeMarginSource: 'calculated',
      marginLevelSource: 'calculated',
      warnings: expect.arrayContaining([
        'backend_equity_mismatch',
        'backend_free_margin_mismatch',
        'backend_margin_level_mismatch',
      ]),
    });
  });

  it('does not override backend equity when position profit is not reliable enough to reconcile', () => {
    const resolved = resolveTradeAccountMetrics({
      balance: 1000,
      equity: 1200,
      margin: 100,
      freeMargin: 1100,
      marginLevel: 1200,
    }, {
      floatingProfit: 0,
      canReconcileEquity: false,
    });

    expect(resolved).toMatchObject({
      equity: 1200,
      equitySource: 'backend',
      warnings: [],
    });
  });

  it('treats normalized equity as missing when backend did not actually send equity', () => {
    const resolved = resolveTradeAccountMetrics({
      balance: 1000,
      equity: 1000,
      margin: 100,
      freeMargin: 900,
      marginLevel: 1000,
      hasBackendEquity: false,
    }, {
      floatingProfit: 10,
      canReconcileEquity: false,
    });

    expect(resolved).toMatchObject({
      equity: 1010,
      calculatedEquity: 1010,
      equitySource: 'calculated',
      warnings: expect.arrayContaining(['missing_backend_equity']),
    });
  });

  it('uses cent-level tolerance for large account metric mismatches', () => {
    const resolved = resolveTradeAccountMetrics({
      balance: 1_000_000,
      equity: 1_000_050,
      margin: 100,
      freeMargin: 999_950,
      marginLevel: 1_000_050,
    }, {
      floatingProfit: 0,
      canReconcileEquity: true,
    });

    expect(resolved).toMatchObject({
      equity: 1_000_000,
      equitySource: 'calculated',
      warnings: expect.arrayContaining(['backend_equity_mismatch']),
    });
  });

  it('recalculates derived free margin and margin level when backend derived fields are wrong', () => {
    const resolved = resolveTradeAccountMetrics({
      balance: 1000,
      equity: 1010,
      margin: 100,
      freeMargin: 100,
      marginLevel: 100,
    }, {
      floatingProfit: 10,
      canReconcileEquity: true,
    });

    expect(resolved).toMatchObject({
      equity: 1010,
      equitySource: 'backend',
      freeMargin: 910,
      freeMarginSource: 'calculated',
      marginLevel: 1010,
      marginLevelSource: 'calculated',
      warnings: expect.arrayContaining([
        'backend_free_margin_mismatch',
        'backend_margin_level_mismatch',
      ]),
    });
  });

  it('includes backend credit or bonus when reconstructing MT-style equity', () => {
    const resolved = resolveTradeAccountMetrics({
      balance: 1000,
      credit: 50,
      equity: 1060,
      margin: 10,
      freeMargin: 1050,
      marginLevel: 10600,
    }, {
      floatingProfit: 10,
      canReconcileEquity: true,
    });

    expect(resolved).toMatchObject({
      credit: 50,
      calculatedEquity: 1060,
      equity: 1060,
      equitySource: 'backend',
    });
  });
});
