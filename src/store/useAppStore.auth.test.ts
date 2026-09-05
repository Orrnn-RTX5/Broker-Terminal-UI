// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppStore } from './useAppStore';
import {
  getCommittedBrokerAccountSessionScope,
  onSessionChange,
} from '../services/brokerSession';

describe('useAppStore authenticated login commit', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.getState().reset();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('commits authentication and the active saved account in one store action', () => {
    useAppStore.getState().setAuthenticated(
      true,
      '200001',
      'access-token',
      'refresh-token',
      1_900_000_000_000,
      {
        login: 200001,
        name: 'TEST',
        server: 'TEST',
        isLive: true,
      },
    );

    const state = useAppStore.getState();
    expect(state).toMatchObject({
      isAuthenticated: true,
      accountId: '200001',
      authToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenExpiresAt: 1_900_000_000_000,
    });
    expect(state.savedAccounts).toEqual([
      expect.objectContaining({
        login: 200001,
        name: 'TEST',
        server: 'TEST',
        isLive: true,
      }),
    ]);
  });

  it('upserts the same login without duplicating the Navigator account', () => {
    const store = useAppStore.getState();
    store.addSavedAccount({ login: 200001, name: 'Old', server: 'TEST', isLive: true });
    store.setAuthenticated(true, '200001', 'next-token', undefined, undefined, {
      login: 200001,
      name: 'Updated',
      server: 'TEST',
      isLive: true,
    });

    expect(useAppStore.getState().savedAccounts).toHaveLength(1);
    expect(useAppStore.getState().savedAccounts[0]).toMatchObject({
      login: 200001,
      name: 'Updated',
    });
  });

  it('clears prior-account trade data synchronously when the active account changes', () => {
    const store = useAppStore.getState();
    store.setAuthenticated(true, '200001', 'token-a');
    useAppStore.getState().setAccount({
      balance: 1000,
      equity: 1010,
      margin: 10,
      freeMargin: 1000,
      unrealizedPL: 10,
      marginLevel: 10_100,
      currency: 'USD',
      leverage: 100,
    });
    useAppStore.getState().setPositions([{
      id: 17,
      symbol: 'EURUSD',
      side: 'BUY',
      volume: 0.1,
      openPrice: 1.1,
      currentPrice: 1.101,
      openTime: '2026-09-02T10:00:00.000Z',
      sl: 0,
      tp: 0,
      swap: 0,
      commission: 0,
      unrealizedPnL: 10,
    }]);

    useAppStore.getState().setActiveAccount(200002);

    expect(useAppStore.getState()).toMatchObject({
      accountId: '200002',
      account: null,
      positions: [],
      orders: [],
      trades: [],
    });
  });

  it('emits one account-change only after the authenticated store and session scope are reset', () => {
    useAppStore.getState().setAuthenticated(true, '200001', 'token-a');
    useAppStore.getState().setPositions([{
      id: 17,
      symbol: 'EURUSD',
      side: 'BUY',
      volume: 0.1,
      openPrice: 1.1,
      currentPrice: 1.101,
      openTime: '2026-09-02T10:00:00.000Z',
      sl: 0,
      tp: 0,
      swap: 0,
      commission: 0,
      unrealizedPnL: 10,
    }]);

    const observed: Array<{
      reason: string;
      accountId: string | null;
      committedAccountId: string | null;
      positionCount: number;
    }> = [];
    const unsubscribe = onSessionChange((reason) => {
      if (reason !== 'account_change') return;
      const state = useAppStore.getState();
      observed.push({
        reason,
        accountId: state.accountId,
        committedAccountId: getCommittedBrokerAccountSessionScope().accountId,
        positionCount: state.positions.length,
      });
    });

    useAppStore.getState().setActiveAccount(200002);
    useAppStore.getState().setActiveAccount(200002);
    unsubscribe();

    expect(observed).toEqual([{
      reason: 'account_change',
      accountId: '200002',
      committedAccountId: '200002',
      positionCount: 0,
    }]);
  });

  it('does not emit or commit a ghost authenticated account change while logged out', () => {
    useAppStore.getState().setAuthenticated(false);
    const sessionChanges: string[] = [];
    const unsubscribe = onSessionChange((reason) => sessionChanges.push(reason));

    useAppStore.getState().setActiveAccount(200003);
    unsubscribe();

    expect(sessionChanges).toEqual([]);
    expect(getCommittedBrokerAccountSessionScope()).toMatchObject({
      authenticated: false,
      accountId: null,
    });
  });
});
