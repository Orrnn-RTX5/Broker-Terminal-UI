import { describe, expect, it } from 'vitest';
import { resolveTradeAccountMetrics } from '../components/BottomDock.trade';
import {
  applyImmediateToolboxPosition,
  applyMarketOrderPlacementState,
  mergeRetainedImmediateToolboxPositions,
  normalizeToolboxAccount,
  normalizeToolboxPosition,
  patchPositionsFromTick,
  patchToolboxPositions,
  replaceToolboxPositions,
  selectWarmToolboxTradeSnapshot,
} from './useToolboxTradeData';

describe('useToolboxTradeData helpers', () => {
  const warmPosition = {
    id: 17,
    symbol: 'EURUSD',
    side: 'BUY' as const,
    volume: 0.1,
    openPrice: 1.1,
    currentPrice: 1.101,
    openTime: '2026-09-02T10:00:00.000Z',
    sl: 0,
    tp: 0,
    swap: 0,
    commission: 0,
    unrealizedPnL: 10,
  };

  it('selects already-loaded positions for the active authenticated session', () => {
    const snapshot = selectWarmToolboxTradeSnapshot({
      isAuthenticated: true,
      accountId: '200001',
      account: null,
      positions: [warmPosition],
    }, 200001, {
      authenticated: true,
      accountId: '200001',
    });

    expect(snapshot?.positions).toEqual([
      expect.objectContaining({ id: 17, ticket: 17, symbol: 'EURUSD' }),
    ]);
  });

  it('never warms Trade with rows from a different account session', () => {
    const snapshot = selectWarmToolboxTradeSnapshot({
      isAuthenticated: true,
      accountId: '200001',
      account: null,
      positions: [warmPosition],
    }, 200002, {
      authenticated: true,
      accountId: '200002',
    });

    expect(snapshot).toBeNull();
  });

  it('shows a provisional market order immediately, then replaces it with the confirmed ticket', () => {
    const pendingDetail = {
      status: 'pending' as const,
      clientOrderId: 'client-order-1',
      login: 200002,
      sessionScope: 'active-scope',
      provisionalTicket: -1001,
      position: {
        ticket: -1001,
        account_login: 200002,
        client_order_id: 'client-order-1',
        symbol: 'XAUUSD',
        side: 'buy',
        volume: 0.01,
        price_open: 4615.5,
        price_current: 4615.5,
      },
    };

    const pending = applyMarketOrderPlacementState([], pendingDetail, 200002, 'active-scope');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      id: -1001,
      clientOrderId: 'client-order-1',
      placementState: 'pending',
    });

    const confirmed = applyMarketOrderPlacementState(pending, {
      ...pendingDetail,
      status: 'confirmed',
      position: {
        ticket: 5010,
        account_login: 200002,
        symbol: 'XAUUSD',
        side: 'buy',
        volume: 0.01,
        price_open: 4615.55,
        price_current: 4615.55,
      },
    }, 200002, 'active-scope');

    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]).toMatchObject({
      id: 5010,
      clientOrderId: 'client-order-1',
      placementState: 'confirmed',
      openPrice: 4615.55,
    });
  });

  it('removes only the matching provisional market order when placement fails', () => {
    const current = [normalizeToolboxPosition({
      ticket: -1001,
      client_order_id: 'client-order-1',
      placement_state: 'pending',
      symbol: 'XAUUSD',
      side: 'sell',
      volume: 0.01,
      price_open: 4615,
    }), normalizeToolboxPosition({
      ticket: -1002,
      client_order_id: 'client-order-2',
      placement_state: 'pending',
      symbol: 'XAUUSD',
      side: 'sell',
      volume: 0.01,
      price_open: 4615,
    })];

    const next = applyMarketOrderPlacementState(current, {
      status: 'failed',
      clientOrderId: 'client-order-1',
      login: 200002,
      sessionScope: 'active-scope',
      provisionalTicket: -1001,
    }, 200002, 'active-scope');

    expect(next.map((position) => position.clientOrderId)).toEqual(['client-order-2']);
  });

  it('inserts a confirmed fill immediately for the active broker account session', () => {
    const current = replaceToolboxPositions([], [{
      ticket: 101,
      account_login: 200002,
      symbol: 'XAUUSD',
      side: 'buy',
      volume: 0.01,
      price_open: 4600,
      price_current: 4600,
    }]);
    const filled = {
      ticket: 102,
      account_login: 200002,
      symbol: 'XAUUSD',
      side: 'sell',
      volume: 0.02,
      price_open: 4601.5,
      price_current: 4601.5,
    };

    const next = applyImmediateToolboxPosition(
      current,
      { login: 200002, position: filled, sessionScope: 'active-scope' },
      200002,
      'active-scope',
    );

    expect(next.map((position) => position.id)).toEqual([102, 101]);
    expect(next[0]).toMatchObject({
      symbol: 'XAUUSD',
      side: 'SELL',
      volume: 0.02,
      openPrice: 4601.5,
    });
  });

  it('ignores late fills from another login or broker session', () => {
    const current = replaceToolboxPositions([], [{
      ticket: 101,
      account_login: 200002,
      symbol: 'XAUUSD',
      side: 'buy',
      volume: 0.01,
      price_open: 4600,
    }]);
    const detail = {
      login: 200002,
      position: {
        ticket: 102,
        symbol: 'XAUUSD',
        side: 'buy',
        volume: 0.01,
        price_open: 4601,
      },
      sessionScope: 'old-scope',
    };

    expect(applyImmediateToolboxPosition(current, detail, 200003, 'old-scope')).toBe(current);
    expect(applyImmediateToolboxPosition(current, detail, 200002, 'new-scope')).toBe(current);
  });

  it('retains an immediate fill across a temporarily stale REST snapshot', () => {
    const immediate = replaceToolboxPositions([], [{
      ticket: 102,
      account_login: 200002,
      symbol: 'XAUUSD',
      side: 'sell',
      volume: 0.01,
      price_open: 4601,
    }])[0];
    const staleSnapshot = replaceToolboxPositions([], [{
      ticket: 101,
      account_login: 200002,
      symbol: 'XAUUSD',
      side: 'buy',
      volume: 0.01,
      price_open: 4600,
    }]);

    expect(mergeRetainedImmediateToolboxPositions(
      staleSnapshot,
      [{ position: immediate, expiresAt: 40_000 }],
      10_000,
    ).map((position) => position.id)).toEqual([102, 101]);
  });

  it('deduplicates broker-confirmed fills and drops expired retention', () => {
    const confirmedSnapshot = replaceToolboxPositions([], [{
      ticket: 102,
      account_login: 200002,
      symbol: 'XAUUSD',
      side: 'sell',
      volume: 0.01,
      price_open: 4601,
    }]);
    const immediate = confirmedSnapshot[0];

    expect(mergeRetainedImmediateToolboxPositions(
      confirmedSnapshot,
      [{ position: immediate, expiresAt: 40_000 }],
      10_000,
    )).toHaveLength(1);
    expect(mergeRetainedImmediateToolboxPositions(
      [],
      [{ position: immediate, expiresAt: 9_999 }],
      10_000,
    )).toEqual([]);
  });

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

  it('keeps open-trade rows stable when sparse unknown records race a snapshot', () => {
    const initial = replaceToolboxPositions([], [
      {
        ticket: 24_155,
        symbol: 'BTCUSD',
        side: 'buy',
        volume: 0.01,
        price_open: 79_500,
        price_current: 79_600,
        profit: -1.5,
      },
      {
        ticket: 24_151,
        symbol: 'BTCUSD',
        side: 'buy',
        volume: 0.01,
        price_open: 79_490,
        price_current: 79_600,
        profit: -1.6,
      },
    ]);

    const racedSnapshot = replaceToolboxPositions(initial, [
      { ticket: 24_155, price_current: 79_608.32, profit: -1.65 },
      { id: 1, currentPrice: 0, unrealizedPnL: 0 },
      { ticket: 24_185, price_current: 79_608.32, profit: -0.22 },
      {
        ticket: 24_151,
        symbol: 'BTCUSD',
        side: 'buy',
        volume: 0.01,
        price_current: 79_608.32,
        profit: -1.66,
      },
    ]);

    expect(racedSnapshot.map((position) => position.id)).toEqual([24_155, 24_151]);
    expect(racedSnapshot[0]).toMatchObject({
      symbol: 'BTCUSD',
      volume: 0.01,
      openPrice: 79_500,
      currentPrice: 79_608.32,
      profit: -1.65,
    });
    expect(racedSnapshot).toHaveLength(initial.length);
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

