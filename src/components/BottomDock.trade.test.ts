import { describe, expect, it } from 'vitest';

import {
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

  it('displays backend account metrics verbatim', () => {
    const resolved = resolveTradeAccountMetrics({
      balance: 1000,
      equity: 1010,
      margin: 100,
      freeMargin: 910,
      marginLevel: 1010,
    });

    expect(resolved).toMatchObject({
      balance: 1000,
      equity: 1010,
      margin: 100,
      freeMargin: 910,
      marginLevel: 1010,
      equitySource: 'backend',
      freeMarginSource: 'backend',
      marginLevelSource: 'backend',
      warnings: [],
    });
  });

  it('keeps the backend value even when a local calculation would produce a very different one', () => {
    // A client-side reconstruction of MT-style equity would give
    // balance + credit + floating = 999998.56 + 0 + 5543.22 = 1005541.78,
    // which is ~18k below what the server reports. The server still wins.
    const resolved = resolveTradeAccountMetrics({
      balance: 999998.56,
      equity: 1023501.78,
      margin: 30,
      freeMargin: 1023471.78,
      marginLevel: 3411672.6,
    });

    expect(resolved.equity).toBe(1023501.78);
    expect(resolved.freeMargin).toBe(1023471.78);
    expect(resolved.marginLevel).toBe(3411672.6);
    expect(resolved).toMatchObject({
      equitySource: 'backend',
      freeMarginSource: 'backend',
      marginLevelSource: 'backend',
      warnings: [],
    });
  });

  it('never substitutes a locally derived free margin or margin level for the backend ones', () => {
    // equity - margin would be 910 and (equity / margin) * 100 would be 1010, but the
    // backend says otherwise and the backend is authoritative.
    const resolved = resolveTradeAccountMetrics({
      balance: 1000,
      equity: 1010,
      margin: 100,
      freeMargin: 100,
      marginLevel: 100,
    });

    expect(resolved).toMatchObject({
      equity: 1010,
      freeMargin: 100,
      marginLevel: 100,
      equitySource: 'backend',
      freeMarginSource: 'backend',
      marginLevelSource: 'backend',
      warnings: [],
    });
  });

  it('reports equity as unavailable when the backend did not send it', () => {
    const resolved = resolveTradeAccountMetrics({
      balance: 1000,
      equity: 1000,
      margin: 100,
      freeMargin: 900,
      marginLevel: 1000,
      hasBackendEquity: false,
    });

    expect(resolved).toMatchObject({
      equity: null,
      equitySource: 'unavailable',
      freeMargin: 900,
      freeMarginSource: 'backend',
      warnings: ['missing_backend_equity'],
    });
  });

  it('reports every metric as unavailable when the backend sent none of them', () => {
    const resolved = resolveTradeAccountMetrics({
      balance: 1000,
      margin: 100,
    });

    expect(resolved).toMatchObject({
      balance: 1000,
      margin: 100,
      equity: null,
      freeMargin: null,
      marginLevel: null,
      equitySource: 'unavailable',
      freeMarginSource: 'unavailable',
      marginLevelSource: 'unavailable',
      warnings: [
        'missing_backend_equity',
        'missing_backend_free_margin',
        'missing_backend_margin_level',
      ],
    });
  });

  it('reports every metric as unavailable for a missing account', () => {
    expect(resolveTradeAccountMetrics(null)).toMatchObject({
      balance: 0,
      credit: 0,
      margin: 0,
      equity: null,
      freeMargin: null,
      marginLevel: null,
      equitySource: 'unavailable',
      freeMarginSource: 'unavailable',
      marginLevelSource: 'unavailable',
    });
  });

  it('honours backend zero and negative metrics instead of treating them as missing', () => {
    const resolved = resolveTradeAccountMetrics({
      balance: 500,
      equity: -25,
      margin: 0,
      freeMargin: 0,
      marginLevel: 0,
    });

    expect(resolved).toMatchObject({
      equity: -25,
      freeMargin: 0,
      marginLevel: 0,
      equitySource: 'backend',
      freeMarginSource: 'backend',
      marginLevelSource: 'backend',
      warnings: [],
    });
  });

  it('accepts the backend free margin and margin level under their snake_case aliases', () => {
    const resolved = resolveTradeAccountMetrics({
      balance: 1000,
      equity: 1010,
      margin: 100,
      margin_free: 910,
      margin_level: 1010,
    });

    expect(resolved).toMatchObject({
      freeMargin: 910,
      marginLevel: 1010,
      freeMarginSource: 'backend',
      marginLevelSource: 'backend',
      warnings: [],
    });
  });

  it('passes balance, credit and margin straight through', () => {
    const resolved = resolveTradeAccountMetrics({
      balance: 1000,
      credit: 50,
      equity: 1060,
      margin: -5,
      freeMargin: 1050,
      marginLevel: 10600,
    });

    expect(resolved).toMatchObject({
      balance: 1000,
      credit: 50,
      // margin is clamped at zero, everything else is untouched
      margin: 0,
      equity: 1060,
      equitySource: 'backend',
    });
  });

  it('reads credit from the bonus alias', () => {
    expect(resolveTradeAccountMetrics({
      balance: 1000,
      bonus: 75,
      equity: 1075,
      freeMargin: 1075,
      marginLevel: 0,
    })).toMatchObject({ credit: 75 });
  });
});
