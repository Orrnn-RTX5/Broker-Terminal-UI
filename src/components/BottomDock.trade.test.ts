import { describe, expect, it } from 'vitest';

import {
  applyLivePositionProfit,
  formatPositionProfit,
  resolvePositionProfitDigits,
  calculateLivePositionProfit,
  resolveTradeAccountMetrics,
  resolveTradeProfit,
} from './BottomDock.trade';

describe('backend Trade financial values', () => {
  const account = {
    balance: 1000, credit: 50, equity: 1060, margin: 100,
    freeMargin: 910, marginLevel: 1010, unrealizedPL: 8.25,
  };

  it('uses backend profit even when prices, lots or currency would suggest another value', () => {
    expect(resolveTradeProfit({
      symbol: 'BTCUSD', side: 'BUY', volume: 0.01, openPrice: 66294.16,
      currentPrice: 66299.70, contract_size: 100, profit: 5540, hasBackendProfit: true,
    })).toEqual({ value: 5540, source: 'backend', warnings: [] });
  });

  it('does not estimate missing profit from a complete price and contract snapshot', () => {
    expect(resolveTradeProfit({
      symbol: 'BTCUSD', side: 'BUY', volume: 0.01, openPrice: 66294.16,
      currentPrice: 66299.70, contract_size: 1,
    })).toEqual({ value: null, source: 'missing', warnings: ['missing_backend_profit'] });
  });

  it('does not promote an internal zero placeholder into backend profit', () => {
    expect(resolveTradeProfit({ profit: 0, unrealizedPnL: 0, hasBackendProfit: false }).value).toBeNull();
  });

  it.each([0, -12.75, 12.75])('preserves explicit backend profit %s', profit => {
    expect(resolveTradeProfit({ profit }).value).toBe(profit);
    expect(resolveTradeProfit({ unrealized_pl: String(profit) }).value).toBe(profit);
    expect(resolveTradeProfit({ profit: { amount: String(profit), currency: 'USD' } }).value).toBe(profit);
  });

  it.each([null, undefined, '', ' ', 'invalid', NaN, Infinity, false])('reports invalid profit %s as unavailable', profit => {
    expect(resolveTradeProfit({ profit }).value).toBeNull();
  });

  it('passes all backend account values through without deriving balances or totals', () => {
    expect(resolveTradeAccountMetrics(account)).toMatchObject({ ...account, warnings: [] });
    expect(resolveTradeAccountMetrics({ ...account, equity: 10300, freeMargin: -5, marginLevel: 12 })).toMatchObject({
      equity: 10300, freeMargin: -5, marginLevel: 12, unrealizedPL: 8.25,
    });
  });

  it('uses the account floating profit even when it disagrees with equity minus balance', () => {
    expect(resolveTradeAccountMetrics({ ...account, floating_pnl: -81.4, unrealizedPL: undefined })).toMatchObject({
      unrealizedPL: -81.4, equity: 1060, balance: 1000,
    });
  });

  it('reports all missing account financial values as unavailable', () => {
    expect(resolveTradeAccountMetrics(null)).toMatchObject({
      balance: null, credit: null, equity: null, margin: null,
      freeMargin: null, marginLevel: null, unrealizedPL: null,
    });
    expect(resolveTradeAccountMetrics({ balance: 1000, equity: 1025 }).unrealizedPL).toBeNull();
  });

  it('honors provenance for every normalized placeholder', () => {
    expect(resolveTradeAccountMetrics({
      ...account,
      hasBackendBalance: false, hasBackendCredit: false, hasBackendEquity: false,
      hasBackendMargin: false, hasBackendFreeMargin: false, hasBackendMarginLevel: false,
      hasBackendUnrealizedPL: false,
    })).toMatchObject({
      balance: null, credit: null, equity: null, margin: null,
      freeMargin: null, marginLevel: null, unrealizedPL: null,
    });
  });

  it.each([0, -5])('preserves every explicit backend account value %s', value => {
    const resolved = resolveTradeAccountMetrics({
      balance: value, credit: value, equity: value, margin: value,
      freeMargin: value, marginLevel: value, unrealizedPL: value,
    });
    expect(resolved).toMatchObject({
      balance: value, credit: value, equity: value,
      freeMargin: value, marginLevel: value, unrealizedPL: value, warnings: [],
    });
    // A negative used margin is not a real requirement, so it is reported as
    // unavailable rather than rendered verbatim. This matches
    // `normalizeAccountMetrics`, which clears `hasBackendMargin` when margin < 0.
    expect(resolved.margin).toBe(value < 0 ? null : value);
  });

  it('accepts backend aliases and Money values', () => {
    expect(resolveTradeAccountMetrics({
      balance: '1,000.25', bonus: 75, equity: { amount: '1010.50' },
      margin: 100, margin_free: 910, margin_level: 1010, floating_pnl: { amount: '10.25' },
    })).toMatchObject({
      balance: 1000.25, credit: 75, equity: 1010.5,
      margin: 100, freeMargin: 910, marginLevel: 1010, unrealizedPL: 10.25,
    });
  });
});

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

  // MERGE: origin/main also asserted `warnings` contained 'missing_contract_size' and
  // 'missing_profit_currency'. HEAD's backend-authoritative rewrite removed the
  // contract-size / profit-currency diagnostics from resolveTradeProfit (they only ever
  // described the local estimate paths, which both branches deleted), so the warning
  // contract is now exactly [] or ['missing_backend_profit'].
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
      warnings: [],
    });
  });

  // MERGE: origin/main expected `value: 0` and an `estimate: null` field. The merged
  // contract reports an unavailable backend profit as `value: null` with no `estimate`
  // field, so the UI renders a placeholder instead of a misleading $0.00.
  it('does not invent live profit when backend profit is missing', () => {
    expect(resolveTradeProfit({
      symbol: 'BTCUSD',
      side: 'BUY',
      volume: 0.01,
      openPrice: 66294.16,
      currentPrice: 66299.70,
      contract_size: 1,
      hasBackendProfit: false,
    })).toMatchObject({
      value: null,
      source: 'missing',
    });
  });

  it('treats omitted profit as missing rather than a calculated display value', () => {
    expect(resolveTradeProfit({
      symbol: 'EURUSD',
      side: 'BUY',
      volume: 1,
      openPrice: 1.1,
      currentPrice: 1.2,
    })).toMatchObject({
      value: null,
      source: 'missing',
    });
  });

  // MERGE: origin/main passed `{ accountCurrency: 'USD' }` and expected a
  // 'requires_profit_currency_conversion' warning. resolveTradeProfit no longer accepts
  // options and never converts or estimates, so the surviving guarantee is that a
  // cross-currency position without backend profit is reported unavailable.
  it('reports a cross-currency position without backend profit as unavailable instead of converting it', () => {
    const resolved = resolveTradeProfit({
      symbol: 'EURGBP',
      side: 'BUY',
      volume: 0.01,
      openPrice: 0.8500,
      currentPrice: 0.8510,
      contract_size: 100000,
      currency_profit: 'GBP',
      hasBackendProfit: false,
    });

    expect(resolved).toMatchObject({
      value: null,
      source: 'missing',
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
      balance: null,
      credit: null,
      margin: null,
      equity: null,
      freeMargin: null,
      marginLevel: null,
      floatingPnL: null,
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
      // Invalid used margin is unavailable, never a manufactured zero.
      margin: null,
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

  it('keeps the last figures of a quiet account but hides a snapshot the backend marks stale', () => {
    const now = 1_700_000_000_000;
    const fresh = resolveTradeAccountMetrics({
      balance: 1000,
      equity: 1010,
      freeMargin: 910,
      marginLevel: 1010,
      metricsStatus: 'valid',
      metricUpdatedAt: { balance: now, equity: now, freeMargin: now, marginLevel: now },
    }, now);

    expect(fresh).toMatchObject({ balance: 1000, equity: 1010, warnings: [] });

    const stale = resolveTradeAccountMetrics({
      balance: 1000,
      equity: 1010,
      freeMargin: 910,
      marginLevel: 1010,
      metricsStatus: 'valid',
      metricUpdatedAt: { balance: now - 60_000, equity: now - 60_000, freeMargin: now - 60_000, marginLevel: now - 60_000 },
    }, now);

    // No new publication for a minute (nothing changed): still the last backend values.
    expect(stale).toMatchObject({ balance: 1000, equity: 1010, freeMargin: 910, marginLevel: 1010 });

    const marked = resolveTradeAccountMetrics({
      balance: 1000,
      equity: 1010,
      freeMargin: 910,
      marginLevel: 1010,
      metricsStatus: 'stale',
      metricUpdatedAt: { balance: now, equity: now, freeMargin: now, marginLevel: now },
    }, now);

    expect(marked).toMatchObject({
      balance: null,
      equity: null,
      freeMargin: null,
      marginLevel: null,
      equitySource: 'unavailable',
    });

    const invalidated = resolveTradeAccountMetrics({
      balance: 1000,
      equity: 1010,
      freeMargin: 910,
      marginLevel: 1010,
      metricsStatus: 'unavailable',
    }, now);

    expect(invalidated).toMatchObject({ balance: null, equity: null, equitySource: 'unavailable' });
  });
});

describe('live account metrics between backend snapshots', () => {
  const metrics = resolveTradeAccountMetrics({
    balance: 10025.36, credit: 0, equity: 10024.76, margin: 25.08,
    freeMargin: 9999.68, marginLevel: 39972.53, unrealizedPL: -0.6,
  });
  // The three BTCUSD 0.01-lot rows from the Trade tab at 83559.53.
  const positions = [
    { symbol: 'BTCUSD', side: 'BUY', volume: 0.01, openPrice: 83574.78, currentPrice: 83559.53, profit: -0.15 },
    { symbol: 'BTCUSD', side: 'BUY', volume: 0.01, openPrice: 83613.04, currentPrice: 83559.53, profit: -0.54 },
    { symbol: 'BTCUSD', side: 'BUY', volume: 0.01, openPrice: 83603.41, currentPrice: 83559.53, profit: -0.44 },
  ];

  it('shows unrounded row profit when it rounds to the backend value', () => {
    expect(resolveTradeProfit(positions[0]).value).toBeCloseTo(-0.1525, 10);
    // Currency conversion or an unknown contract size: backend value verbatim.
    expect(resolveTradeProfit({ ...positions[0], profit: -0.2 }).value).toBe(-0.2);
    expect(resolveTradeProfit({ ...positions[0], hasBackendCurrentPrice: false }).value).toBe(-0.15);
  });

  it('derives floating P/L, equity, free margin and level from the live rows', () => {
    const live = applyLivePositionProfit(metrics, positions);
    expect(live.balance).toBe(10025.36);
    expect(live.margin).toBe(25.08);
    expect(live.floatingPnL).toBeCloseTo(-1.1264, 10);
    expect(live.equity).toBeCloseTo(10024.2336, 10);
    expect(live.freeMargin).toBeCloseTo(9999.1536, 10);
    expect(live.marginLevel).toBeCloseTo((10024.2336 / 25.08) * 100, 8);
  });

  it('adds swap and commission, which backend position profit excludes', () => {
    const live = applyLivePositionProfit(metrics, [{ ...positions[0], swap: -1, commission: -0.5 }]);
    expect(live.floatingPnL).toBeCloseTo(-1.6525, 10);
  });

  it('keeps backend values when a row has no backend profit or a metric is unavailable', () => {
    expect(applyLivePositionProfit(metrics, [...positions, { ...positions[0], hasBackendProfit: false }])).toBe(metrics);
    expect(applyLivePositionProfit(metrics, [])).toEqual({
      ...metrics,
      floatingPnL: 0,
      unrealizedPL: 0,
    });
    const partial = applyLivePositionProfit({ ...metrics, freeMargin: null, marginLevel: null }, positions);
    expect(partial).toMatchObject({ freeMargin: null, marginLevel: null });
    expect(partial.equity).toBeCloseTo(10024.2336, 10);
  });

  it('formats row profit with account-currency digits, not a USD-only heuristic', () => {
    expect(formatPositionProfit(-0.1525, 2)).toBe('-0.15');
    expect(formatPositionProfit(-0.00001, 2)).toBe('0.00');
    expect(formatPositionProfit(42.5, 3)).toBe('42.500');
    expect(formatPositionProfit(1234.5, 0)).toBe('1 235');
    expect(formatPositionProfit(12345.678, 2)).toBe('12 345.68');
    expect(resolvePositionProfitDigits({ currency: 'USD' })).toBe(2);
    expect(resolvePositionProfitDigits({ currency: 'JPY' })).toBe(0);
    expect(resolvePositionProfitDigits({ currency: 'KWD' })).toBe(3);
    expect(resolvePositionProfitDigits({ currency: 'USD', currencyDigits: 3 })).toBe(3);
  });
});
