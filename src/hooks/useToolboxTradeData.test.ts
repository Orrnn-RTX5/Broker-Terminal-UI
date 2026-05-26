import { describe, expect, it } from 'vitest';
import {
  normalizeToolboxAccount,
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
    });

    expect(account).toMatchObject({
      balance: 10000,
      equity: 10005.5,
      margin: 10,
      freeMargin: 9995.5,
      marginLevel: 100055,
      unrealizedPL: 5.5,
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
      time_create: 1774502950,
      time_update: 1774503999,
    });
    expect(patched.find((position) => position.id === 102)).toBe(initial.find((position) => position.id === 102));
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

