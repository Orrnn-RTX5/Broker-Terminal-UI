import { describe, expect, it } from 'vitest';
import { resolveTradeAccountMetrics } from '../components/BottomDock.trade';
import {
  normalizeToolboxAccount,
  patchPositionsFromTick,
  patchToolboxPositions,
  replaceToolboxPositions,
} from './useToolboxTradeData';

describe('useToolboxTradeData helpers', () => {
  it('normalizes account metrics from broker field names', () => {
    const account = normalizeToolboxAccount({
      balance: 10000,
      equity: 10005.5,
      used_margin: 10,
      free_margin: 9995.5,
      margin_level: 100055,
      floating_pnl: 5.5,
      credit: 50,
    });

    expect(account).toMatchObject({
      balance: 10000,
      equity: 10005.5,
      margin: 10,
      freeMargin: 9995.5,
      marginLevel: 100055,
      unrealizedPL: 5.5,
      credit: 50,
      hasBackendEquity: true,
      hasBackendFreeMargin: true,
      hasBackendMarginLevel: true,
    });
  });

  it('marks derived account fields as missing when backend does not send them', () => {
    const account = normalizeToolboxAccount({
      balance: 10000,
      used_margin: 10,
      floating_pnl: 5.5,
    });

    expect(account).toMatchObject({
      balance: 10000,
      equity: 10000,
      freeMargin: 0,
      marginLevel: 0,
      hasBackendEquity: false,
      hasBackendFreeMargin: false,
      hasBackendMarginLevel: false,
    });
  });

  it('protects a funded balance from a zero-balance packet without fabricating equity', () => {
    const previous = normalizeToolboxAccount({
      balance: 10000,
      equity: 10005.5,
      used_margin: 10,
      free_margin: 9995.5,
      margin_level: 100055,
      floating_pnl: 5.5,
    });

    const account = normalizeToolboxAccount(
      { balance: 0, equity: 9800.25, free_margin: 0, margin_level: 0, floating_pnl: -2 },
      previous,
    );

    // Known-funded balance is preserved: the packet's 0 is rejected.
    expect(account.balance).toBe(10000);
    // Everything else from that same packet is untrustworthy -> reported as unavailable.
    expect(account.hasBackendEquity).toBe(false);
    expect(account.hasBackendFreeMargin).toBe(false);
    expect(account.hasBackendMarginLevel).toBe(false);
    // No locally reconstructed equity (balance + floating P/L would have been 9998).
    expect(account.equity).not.toBe(10000 + -2);
    expect(resolveTradeAccountMetrics(account)).toMatchObject({
      balance: 10000,
      equity: null,
      freeMargin: null,
      marginLevel: null,
      equitySource: 'unavailable',
      freeMarginSource: 'unavailable',
      marginLevelSource: 'unavailable',
    });
  });

  it('rejects a zero-balance packet even when it carries no equity at all', () => {
    const previous = normalizeToolboxAccount({ balance: 5000, equity: 5000, free_margin: 5000, margin_level: 0 });
    const account = normalizeToolboxAccount({ balance: 0 }, previous);

    expect(account.balance).toBe(5000);
    expect(account.hasBackendEquity).toBe(false);
    expect(resolveTradeAccountMetrics(account).equitySource).toBe('unavailable');
  });

  it('keeps trusting a genuine zero balance when no funded balance was known', () => {
    const account = normalizeToolboxAccount(
      { balance: 0, equity: 0, free_margin: 0, margin_level: 0 },
      { balance: 0, equity: 0, margin: 0, freeMargin: 0, marginLevel: 0, unrealizedPL: 0, currency: 'USD', leverage: 100 },
    );

    expect(account.balance).toBe(0);
    expect(account.hasBackendEquity).toBe(true);
    expect(resolveTradeAccountMetrics(account)).toMatchObject({
      equity: 0,
      equitySource: 'backend',
      freeMarginSource: 'backend',
      marginLevelSource: 'backend',
    });
  });

  it('patches live position fields without dropping other rows or static data', () => {
    const initial = replaceToolboxPositions([], [
      {
        ticket: 101,
        account_login: 200116,
        symbol: 'GBPUSD',
        side: 'sell',
        volume: 0.01,
        price_open: 1.35031,
        price_current: 1.34994,
        price_tp: 1.34815,
        profit: 0,
        swap: 0.01,
        time_create: 1774502950,
      },
      {
        ticket: 102,
        account_login: 200116,
        symbol: 'BTCUSD',
        side: 'buy',
        volume: 0.02,
        price_open: 77000,
        price_current: 77100,
        profit: 2,
        time_create: 1774502999,
      },
    ]);

    const patched = patchToolboxPositions(initial, [
      {
        ticket: 101,
        price_current: 1.34705,
        profit: 2.24,
        time_update: 1774503999,
      },
    ]);

    expect(patched).toHaveLength(2);
    expect(patched.find((position) => position.id === 101)).toMatchObject({
      account_login: 200116,
      symbol: 'GBPUSD',
      volume: 0.01,
      openPrice: 1.35031,
      currentPrice: 1.34705,
      unrealizedPnL: 2.24,
      hasBackendProfit: true,
      time_create: 1774502950,
      time_update: 1774503999,
    });
    expect(patched.find((position) => position.id === 102)).toBe(initial.find((position) => position.id === 102));
  });

  it('preserves backend profit when current price changes without fresh profit', () => {
    const initial = replaceToolboxPositions([], [
      {
        ticket: 101,
        account_login: 200116,
        symbol: 'GBPUSD',
        side: 'sell',
        volume: 0.01,
        price_open: 1.35031,
        price_current: 1.34994,
        profit: 0.37,
        contract_size: 100000,
      },
    ]);

    const patched = patchToolboxPositions(initial, [
      {
        ticket: 101,
        price_current: 1.34705,
        time_update: 1774503999,
      },
    ]);

    expect(patched[0]).toMatchObject({
      currentPrice: 1.34705,
      price_current: 1.34705,
      profit: 0.37,
      hasBackendProfit: true,
    });
  });

  it('preserves backend BTC profit on quote tick updates', () => {
    const initial = replaceToolboxPositions([], [
      {
        ticket: 501,
        account_login: 200020,
        symbol: 'BTCUSD',
        side: 'sell',
        volume: 0.01,
        price_open: 62945.81,
        price_current: 61140.24,
        profit: 1805.57,
      },
    ]);

    const patched = patchPositionsFromTick(initial, {
      symbol: 'BTCUSD',
      bid: 61117.14,
      ask: 61129.14,
      timestamp: 1774503999,
    });

    expect(patched[0]).toMatchObject({
      currentPrice: 61129.14,
      price_current: 61129.14,
      profit: 1805.57,
      unrealizedPnL: 1805.57,
      hasBackendProfit: true,
    });
  });

  it('removes only close-event tickets', () => {
    const initial = replaceToolboxPositions([], [
      {
        ticket: 101,
        symbol: 'GBPUSD',
        side: 'sell',
        volume: 0.01,
        price_open: 1.35,
      },
      {
        ticket: 102,
        symbol: 'BTCUSD',
        side: 'buy',
        volume: 0.02,
        price_open: 77000,
      },
    ]);

    expect(patchToolboxPositions(initial, [], [101]).map((position) => position.id)).toEqual([102]);
  });
});

