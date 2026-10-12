// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SAVED_ACCOUNTS_STORAGE_KEY, useAppStore } from './useAppStore';
import {
  getCommittedBrokerAccountSessionScope,
  onSessionChange,
} from '../services/brokerSession';

describe('useAppStore authenticated login commit', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.getState().reset();
    useAppStore.setState({ savedAccounts: [] });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__;
  });

  const configureAcceptedBroker = () => {
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = {
      CONFIG_SOURCE: 'deployment',
      API_HOST: 'https://service.orrnn.example',
      WS_HOST: 'wss://service.orrnn.example',
      BROKER_ID: 'Orrnn',
      BROKER_NAME: 'Orrnn',
      DEFAULT_MT5_SERVER: 'Orrnn',
      DISCOVERY_BASE_URL: 'https://directory.example',
    };
    localStorage.setItem('broker_id', 'Orrnn');
    localStorage.setItem('server_url', 'https://service.orrnn.example');
  };

  it('binds the successful login bookmark to its accepted broker despite a different display label', async () => {
    configureAcceptedBroker();
    useAppStore.getState().addSavedAccount({
      login: 200003, name: 'Previous owner', server: 'ORRNN', isLive: true, isFavorite: true,
    });
    useAppStore.getState().setAuthenticated(true, '200003', 'access-secret', 'refresh-secret', undefined, {
      login: 200003, name: 'demo acc1', server: 'ORRNN', isLive: true,
      brokerId: 'untrusted-input', serverUrl: 'https://wrong.example',
      password: 'password-secret', access_token: 'extra-secret',
    } as Parameters<ReturnType<typeof useAppStore.getState>['addSavedAccount']>[0]);

    const expected = {
      login: 200003, name: 'demo acc1', server: 'ORRNN', isFavorite: true,
      brokerId: 'Orrnn', serverUrl: 'https://service.orrnn.example',
    };
    expect(useAppStore.getState().savedAccounts).toEqual([expect.objectContaining(expected)]);
    expect(getCommittedBrokerAccountSessionScope()).toMatchObject({
      authenticated: true, accountId: '200003',
      brokerId: expected.brokerId, serverUrl: expected.serverUrl,
    });
    const persisted = localStorage.getItem(SAVED_ACCOUNTS_STORAGE_KEY)!;
    expect(persisted).not.toContain('secret');
    expect(persisted).not.toContain('untrusted-input');
    expect(persisted).not.toContain('wrong.example');
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().savedAccounts).toEqual([expect.objectContaining(expected)]);
    expect(JSON.parse(persisted)).toEqual([expect.objectContaining(expected)]);
  });

  it.each([
    { brokerId: 'ORRNN', serverUrl: 'https://service.orrnn.example' },
    { brokerId: 'Orrnn', serverUrl: 'https://other.orrnn.example' },
  ])('preserves a different canonical owner sharing the login and display label: $brokerId $serverUrl', (identity) => {
    configureAcceptedBroker();
    const foreignAccount = {
      login: 200003, name: 'Other broker owner', server: 'ORRNN', isLive: true, isFavorite: true, ...identity,
    };
    useAppStore.getState().addSavedAccount(foreignAccount);
    const beforeLogin = useAppStore.getState().savedAccounts[0];
    useAppStore.getState().setAuthenticated(true, '200003', 'accepted-token', undefined, undefined, {
      login: 200003, name: 'Current owner', server: 'ORRNN', isLive: true,
    });

    const accounts = useAppStore.getState().savedAccounts;
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toEqual(beforeLogin);
    expect(accounts[1]).toMatchObject({
      login: 200003, name: 'Current owner', server: 'ORRNN',
      brokerId: 'Orrnn', serverUrl: 'https://service.orrnn.example',
    });
    expect(accounts[1].isFavorite).toBeUndefined();

    useAppStore.getState().removeSavedAccount(200003, 'ORRNN', accounts[1]);
    expect(useAppStore.getState().savedAccounts).toEqual([beforeLogin]);
    expect(JSON.parse(localStorage.getItem(SAVED_ACCOUNTS_STORAGE_KEY)!)).toEqual([beforeLogin]);
  });

  it('publishes the same captured broker identity to the bookmark and session despite a storage change during store notification', () => {
    configureAcceptedBroker();
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (!previous.isAuthenticated && state.isAuthenticated) localStorage.setItem('broker_id', 'Staged next broker');
    });
    try {
      useAppStore.getState().setAuthenticated(true, '200003', 'accepted-token', undefined, undefined, {
        login: 200003, name: 'Current owner', server: 'ORRNN', isLive: true,
      });
      expect(useAppStore.getState().savedAccounts[0].brokerId).toBe('Orrnn');
      expect(getCommittedBrokerAccountSessionScope().brokerId).toBe('Orrnn');
    } finally {
      unsubscribe();
    }
  });

  it('merges an accepted legacy display alias with the restored canonical bookmark and preserves its favorite', () => {
    configureAcceptedBroker();
    const legacy = {
      login: 200003, name: 'Legacy owner', server: 'ORRNN', isLive: true, isFavorite: true,
    };
    const restored = {
      login: 200003, name: 'Restored owner', server: 'https://service.orrnn.example', isLive: true,
      brokerId: 'Orrnn', serverUrl: 'https://service.orrnn.example',
    };
    const foreign = {
      login: 200003, name: 'Foreign owner', server: 'ORRNN', isLive: true, isFavorite: true,
      brokerId: 'ORRNN', serverUrl: 'https://foreign.example',
    };
    useAppStore.setState({ savedAccounts: [legacy, restored, foreign] });

    useAppStore.getState().setAuthenticated(true, '200003', 'accepted-token', undefined, undefined, {
      login: 200003, name: 'Current owner', server: 'ORRNN', isLive: true,
    });

    expect(useAppStore.getState().savedAccounts).toEqual([
      expect.objectContaining({
        login: 200003, name: 'Current owner', server: 'ORRNN', isFavorite: true,
        brokerId: 'Orrnn', serverUrl: 'https://service.orrnn.example',
      }),
      foreign,
    ]);
    expect(JSON.parse(localStorage.getItem(SAVED_ACCOUNTS_STORAGE_KEY)!)).toEqual(useAppStore.getState().savedAccounts);
  });

  it('does not merge conflicting canonical owners when an unbound legacy edit has an ambiguous label', () => {
    const legacy = { login: 200003, name: 'Legacy owner', server: 'Shared display name', isLive: true };
    useAppStore.getState().addSavedAccount({ ...legacy, brokerId: 'One', serverUrl: 'https://one.example' });
    useAppStore.getState().addSavedAccount({ ...legacy, brokerId: 'Two', serverUrl: 'https://two.example' });
    const boundAccounts = useAppStore.getState().savedAccounts;

    useAppStore.getState().addSavedAccount({ ...legacy, isFavorite: true });
    useAppStore.getState().addSavedAccount({ ...legacy, isFavorite: false });

    expect(useAppStore.getState().savedAccounts).toEqual([
      ...boundAccounts,
      expect.objectContaining({ ...legacy, isFavorite: false }),
    ]);
  });

  it('does not use a partial broker ID bookmark to overwrite or merge known endpoints', () => {
    const partial = {
      login: 200003, name: 'Partial owner', server: 'Shared display name', brokerId: 'One', isLive: true,
    };
    useAppStore.getState().addSavedAccount({ ...partial, serverUrl: 'https://one.example' });
    useAppStore.getState().addSavedAccount({ ...partial, serverUrl: 'https://two.example' });
    const boundAccounts = useAppStore.getState().savedAccounts;

    useAppStore.getState().addSavedAccount({ ...partial, isFavorite: true });
    useAppStore.getState().addSavedAccount({ ...partial, isFavorite: false });

    expect(useAppStore.getState().savedAccounts).toEqual([
      ...boundAccounts,
      expect.objectContaining({ ...partial, isFavorite: false }),
    ]);
  });

  it.each([undefined, 'One'])('preserves even one known owner when an incoming bookmark is only partially identified: %s', (brokerId) => {
    const legacy = { login: 200003, name: 'Legacy owner', server: 'Shared display name', isLive: true };
    useAppStore.getState().addSavedAccount({ ...legacy, brokerId: 'One', serverUrl: 'https://one.example' });
    const boundAccount = useAppStore.getState().savedAccounts[0];

    useAppStore.getState().addSavedAccount({ ...legacy, brokerId, isFavorite: true });

    expect(useAppStore.getState().savedAccounts).toEqual([
      boundAccount,
      expect.objectContaining({ ...legacy, isFavorite: true }),
    ]);
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

  it('removes legacy email labels on reload and accepts the later owner name', async () => {
    localStorage.setItem(SAVED_ACCOUNTS_STORAGE_KEY, JSON.stringify([
      { login: 200003, name: 'owner@example.test', server: 'Broker A', isLive: true },
    ]));
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().savedAccounts[0].name).toBe('');
    useAppStore.getState().addSavedAccount({
      login: 200003, name: 'Account Owner', server: 'Broker A', isLive: true,
    });
    expect(useAppStore.getState().savedAccounts[0].name).toBe('Account Owner');
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

  it('rotates a changed token for the same account once without resetting account data', () => {
    useAppStore.getState().setAuthenticated(true, '200001', 'old-token');
    const positions = useAppStore.getState().positions;
    const transitions: string[] = [];
    const unsubscribe = onSessionChange(reason => {
      transitions.push(reason);
      expect(useAppStore.getState().authToken).toBe('new-token');
      expect(getCommittedBrokerAccountSessionScope().accountId).toBe('200001');
    });
    try {
      useAppStore.getState().setAuthenticated(true, '200001', 'new-token');
      useAppStore.getState().setAuthenticated(true, '200001', 'new-token');
      expect(transitions).toEqual(['token_rotation']);
      expect(useAppStore.getState().positions).toBe(positions);
    } finally {
      unsubscribe();
    }
  });

  it('restores favorite accounts from storage after a fresh session without storing credentials', async () => {
    useAppStore.getState().addSavedAccount({
      login: 200001, name: 'Favorite', server: 'Broker A', isLive: false, isFavorite: true,
      password: 'must-not-persist', authToken: 'must-not-persist', refreshToken: 'must-not-persist',
    } as Parameters<ReturnType<typeof useAppStore.getState>['addSavedAccount']>[0]);
    const persisted = localStorage.getItem(SAVED_ACCOUNTS_STORAGE_KEY)!;
    expect(persisted).not.toContain('must-not-persist');
    expect(JSON.parse(persisted)).toEqual([
      expect.objectContaining({ login: 200001, server: 'Broker A', isFavorite: true }),
    ]);

    useAppStore.setState({ savedAccounts: [] });
    localStorage.setItem(SAVED_ACCOUNTS_STORAGE_KEY, persisted);
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().savedAccounts).toEqual([
      expect.objectContaining({ login: 200001, server: 'Broker A', isFavorite: true }),
    ]);
    expect(useAppStore.getState().isAuthenticated).toBe(false);
  });

  it('hydrates legacy account labels while discarding credentials and invalid entries', async () => {
    localStorage.removeItem(SAVED_ACCOUNTS_STORAGE_KEY);
    localStorage.setItem('trading-app-storage', JSON.stringify({ version: 0, state: {
      savedAccounts: [
        { login: 200001, name: 'Legacy', server: 'Broker A', isLive: false, isFavorite: true,
          password: 'legacy-secret', access_token: 'legacy-token' },
        null, { login: -1, server: 'Broker A' }, { login: 200002, server: '' },
      ],
    } }));
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().savedAccounts).toEqual([
      { login: 200001, name: 'Legacy', server: 'Broker A', isLive: false, isFavorite: true },
    ]);
  });

  it('survives old-tab settings writes and application exit resets', async () => {
    useAppStore.getState().addSavedAccount({ login: 200001, name: 'Favorite', server: 'Broker A', isLive: false, isFavorite: true });
    useAppStore.getState().reset();
    localStorage.setItem('trading-app-storage', JSON.stringify({ version: 0, state: { timeframe: 'M5', savedAccounts: [] } }));
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().savedAccounts[0].isFavorite).toBe(true);
  });

  it('synchronizes favorites added or removed in another tab', () => {
    const account = { login: 200001, name: 'Favorite', server: 'Broker A', isLive: false, isFavorite: true };
    localStorage.setItem(SAVED_ACCOUNTS_STORAGE_KEY, JSON.stringify([account]));
    window.dispatchEvent(new StorageEvent('storage', { key: SAVED_ACCOUNTS_STORAGE_KEY, storageArea: localStorage }));
    expect(useAppStore.getState().savedAccounts).toEqual([account]);
    localStorage.setItem(SAVED_ACCOUNTS_STORAGE_KEY, '[]');
    window.dispatchEvent(new StorageEvent('storage', { key: SAVED_ACCOUNTS_STORAGE_KEY, storageArea: localStorage }));
    expect(useAppStore.getState().savedAccounts).toEqual([]);
  });

  it('keeps favorite preferences through login updates and logout, and persists removal', async () => {
    const account = { login: 200001, name: 'Favorite', server: 'Broker A', isLive: false };
    useAppStore.getState().addSavedAccount({ ...account, isFavorite: true });
    useAppStore.getState().setAuthenticated(true, '200001', 'token', undefined, undefined, account);
    expect(useAppStore.getState().savedAccounts[0].isFavorite).toBe(true);
    useAppStore.getState().setAuthenticated(false);
    expect(useAppStore.getState().savedAccounts[0].isFavorite).toBe(true);
    useAppStore.getState().addSavedAccount({ ...account, isFavorite: false });
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().savedAccounts[0].isFavorite).toBe(false);
    useAppStore.getState().removeSavedAccount(200001, 'Broker A');
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().savedAccounts).toEqual([]);
  });

  it('keeps identical login numbers on different brokers independent', () => {
    const account = { login: 200001, name: 'Account', server: 'Broker A', isLive: false };
    useAppStore.getState().addSavedAccount({ ...account, isFavorite: true });
    useAppStore.getState().addSavedAccount({ ...account, server: 'Broker B' });
    useAppStore.getState().addSavedAccount({ ...account, server: 'Broker B', isFavorite: false });
    expect(useAppStore.getState().savedAccounts).toHaveLength(2);
    expect(useAppStore.getState().savedAccounts[0].isFavorite).toBe(true);
    useAppStore.getState().removeSavedAccount(200001, 'Broker B');
    expect(useAppStore.getState().savedAccounts).toEqual([
      expect.objectContaining({ server: 'Broker A', isFavorite: true }),
    ]);
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
