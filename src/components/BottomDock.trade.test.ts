import { describe, expect, it } from 'vitest';
import { resolveTradeAccountMetrics, resolveTradeProfit } from './BottomDock.trade';

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
    expect(resolveTradeAccountMetrics({
      balance: value, credit: value, equity: value, margin: value,
      freeMargin: value, marginLevel: value, unrealizedPL: value,
    })).toMatchObject({
      balance: value, credit: value, equity: value, margin: value,
      freeMargin: value, marginLevel: value, unrealizedPL: value, warnings: [],
    });
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
