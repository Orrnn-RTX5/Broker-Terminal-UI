import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitBrokerAccountSessionScope } from '../../services/brokerSession';
import { loadSessionTradeSnapshot, type SessionTradeSnapshot } from '../../services/tradeStartupSnapshot';
import { useAppStore, type SavedAccount } from '../../store/useAppStore';
import { useAccountSnapshotRuntime } from './useAccountSnapshotRuntime';

vi.mock('../../services/tradeStartupSnapshot', () => ({ loadSessionTradeSnapshot: vi.fn() }));

const brokerA = { brokerId: 'Broker-A', serverUrl: 'https://alpha.example:8443/trading', server: 'Alpha-Live' };
const brokerB = { brokerId: 'Broker-B', serverUrl: 'https://beta.example:9443/trading', server: 'Beta-Live' };
const bookmark = (name: string, server: string, ownership: Pick<SavedAccount, 'brokerId' | 'serverUrl'> = {}): SavedAccount => ({
  ...ownership, login: 200003, name, server, isLive: true, isFavorite: true, lastUsed: 1,
});
const storeBroker = (broker: typeof brokerA) => {
  localStorage.setItem('broker_id', broker.brokerId);
  localStorage.setItem('server_url', broker.serverUrl);
  localStorage.setItem('backend_url', broker.serverUrl);
  localStorage.setItem('rtx_broker_server', broker.server);
};
const snapshot = (name = 'Current owner', metadata: Record<string, unknown> = {}): SessionTradeSnapshot => ({
  accountResult: { status: 'fulfilled', value: {
    id: '200003', balance: 1000, equity: 1000, currency: 'USD', leverage: 100, ...{ name, ...metadata },
  } },
  positionsResult: { status: 'fulfilled', value: [] },
});
const mountSnapshotRuntime = () => {
  const options: Parameters<typeof useAccountSnapshotRuntime>[0] = {
    isAuthenticated: true,
    accountId: '200003',
    accountIdRef: { current: '200003' },
    isAuthenticatedRef: { current: true },
    activeAccountDataRef: { current: 200003 },
    optimisticClosedTicketsRef: { current: new Set() },
    serverClosedTicketsRef: { current: new Set() },
    positionsStreamVersionRef: { current: 0 },
    beginTradeRestRead: () => ({ startedAt: 1, startedVersion: 0, startedLocalMutationVersion: 0 }),
    isStaleTradeRestRead: () => false,
    reconcileOptimisticClosedPositions: positions => positions,
    refreshOrdersAndHistory: vi.fn().mockResolvedValue(undefined),
    refreshPositions: vi.fn().mockResolvedValue(undefined),
    setInitialTradeSnapshotSettledFor: vi.fn(),
  };
  return renderHook(() => useAccountSnapshotRuntime(options));
};
const flushSnapshot = () => act(async () => { await Promise.resolve(); });

describe('account summary saved-account ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    delete (window as Window & { __RTX_RUNTIME_CONFIG__?: unknown }).__RTX_RUNTIME_CONFIG__;
    storeBroker(brokerA);
    commitBrokerAccountSessionScope({ authenticated: true, accountId: '200003', ...brokerA });
    useAppStore.setState({
      isAuthenticated: true, accountId: '200003', authToken: 'test-token',
      savedAccounts: [], account: null, positions: [],
    });
    vi.mocked(loadSessionTradeSnapshot).mockResolvedValue(snapshot());
  });

  afterEach(() => {
    cleanup();
    useAppStore.setState({ isAuthenticated: false, accountId: null, authToken: null, savedAccounts: [], account: null });
    commitBrokerAccountSessionScope({ authenticated: false, accountId: null, brokerId: '', serverUrl: '' });
    localStorage.clear();
  });

  it('creates the current broker bookmark without overwriting another broker with the same login', async () => {
    const foreign = bookmark('Foreign owner', brokerB.server);
    useAppStore.setState({ savedAccounts: [foreign] });

    mountSnapshotRuntime();
    await flushSnapshot();

    expect(useAppStore.getState().savedAccounts).toEqual(expect.arrayContaining([
      foreign,
      expect.objectContaining({
        login: 200003, name: 'Current owner', server: brokerA.server,
        brokerId: brokerA.brokerId, serverUrl: brokerA.serverUrl,
      }),
    ]));
    expect(useAppStore.getState().savedAccounts).toHaveLength(2);
  });

  it('refreshes the matching broker bookmark even when a foreign same-login row is first', async () => {
    const foreign = bookmark('Foreign owner', brokerB.server);
    const own = bookmark('Old owner', brokerA.server);
    useAppStore.setState({ savedAccounts: [foreign, own] });

    mountSnapshotRuntime();
    await flushSnapshot();

    expect(useAppStore.getState().savedAccounts).toEqual(expect.arrayContaining([
      foreign,
      expect.objectContaining({
        ...own, name: 'Current owner', brokerId: brokerA.brokerId,
        serverUrl: brokerA.serverUrl, lastUsed: expect.any(Number),
      }),
    ]));
    expect(useAppStore.getState().savedAccounts).toHaveLength(2);
  });

  it('uses canonical ownership when two brokers saved the same server display label', async () => {
    const foreign = bookmark('Foreign owner', 'Live', brokerB);
    const own = bookmark('Old owner', 'Live', brokerA);
    useAppStore.setState({ savedAccounts: [foreign, own] });

    mountSnapshotRuntime();
    await flushSnapshot();

    expect(useAppStore.getState().savedAccounts).toContainEqual(foreign);
    expect(useAppStore.getState().savedAccounts).toContainEqual(expect.objectContaining({
      ...own, name: 'Current owner', lastUsed: expect.any(Number),
    }));
    expect(useAppStore.getState().savedAccounts).toHaveLength(2);
  });

  it.each([
    { broker: brokerA, accountType: 'demo' },
    { broker: brokerB, accountType: 'real' },
    { broker: { brokerId: 'any-new-broker', serverUrl: 'https://new.example/trading', server: 'Live' }, accountType: 'contest' },
  ] as const)('updates $accountType metadata without an owner name for $broker.brokerId', async ({ broker, accountType }) => {
    storeBroker(broker);
    commitBrokerAccountSessionScope({ authenticated: true, accountId: '200003', ...broker });
    const own = bookmark('Known owner', broker.server, broker);
    const foreign = bookmark('Foreign demo owner', broker.server, {
      brokerId: 'unrelated-broker', serverUrl: 'https://unrelated.example',
    });
    useAppStore.setState({ savedAccounts: [foreign, own] });
    vi.mocked(loadSessionTradeSnapshot).mockResolvedValue(snapshot('', { account_type: accountType }));

    mountSnapshotRuntime();
    await flushSnapshot();

    expect(useAppStore.getState().savedAccounts).toHaveLength(2);
    expect(useAppStore.getState().savedAccounts).toContainEqual(foreign);
    expect(useAppStore.getState().savedAccounts).toContainEqual(expect.objectContaining({
      login: 200003, name: 'Known owner', brokerId: broker.brokerId,
      serverUrl: broker.serverUrl, accountType, isLive: accountType === 'real',
    }));
  });

  it('creates a classified active bookmark even when the summary omits the owner name', async () => {
    vi.mocked(loadSessionTradeSnapshot).mockResolvedValue(snapshot('', { account_type: 'contest' }));

    mountSnapshotRuntime();
    await flushSnapshot();

    expect(useAppStore.getState().savedAccounts).toEqual([expect.objectContaining({
      login: 200003, name: '', brokerId: brokerA.brokerId, serverUrl: brokerA.serverUrl,
      accountType: 'contest', isLive: false,
    })]);
  });

  it('preserves known classification when subsequent summaries omit metadata', async () => {
    useAppStore.setState({ savedAccounts: [{ ...bookmark('Known owner', brokerA.server, brokerA), accountType: 'demo', isLive: false }] });
    vi.mocked(loadSessionTradeSnapshot).mockResolvedValue(snapshot('Updated owner'));

    mountSnapshotRuntime();
    await flushSnapshot();

    expect(useAppStore.getState().savedAccounts).toEqual([expect.objectContaining({
      name: 'Updated owner', accountType: 'demo', isLive: false, brokerId: brokerA.brokerId,
    })]);
  });

  it('corrects a legacy live bookmark from the broker demo group returned by account summary', async () => {
    useAppStore.setState({ savedAccounts: [bookmark('Known owner', brokerA.server, brokerA)] });
    vi.mocked(loadSessionTradeSnapshot).mockResolvedValue(snapshot('', { group: 'orrnn/demo-std' }));

    mountSnapshotRuntime();
    await flushSnapshot();

    expect(useAppStore.getState().savedAccounts).toEqual([expect.objectContaining({
      name: 'Known owner', accountType: 'demo', isLive: false, brokerId: brokerA.brokerId,
    })]);
  });

  it('classifies a non-demo broker group as real while preserving an existing demo registration bookmark', async () => {
    useAppStore.setState({ savedAccounts: [bookmark('Real owner', brokerA.server, brokerA)] });
    vi.mocked(loadSessionTradeSnapshot).mockResolvedValue(snapshot('Real owner', { group: 'standard' }));

    mountSnapshotRuntime();
    await flushSnapshot();

    expect(useAppStore.getState().savedAccounts).toEqual([expect.objectContaining({
      name: 'Real owner', accountType: 'real', isLive: true, brokerId: brokerA.brokerId,
    })]);
  });

  it('does not copy classification from a different broker or infer it from an owner or server label', async () => {
    const foreign = { ...bookmark('Foreign owner', brokerB.server, brokerB), accountType: 'contest' as const, isLive: false };
    useAppStore.setState({ savedAccounts: [foreign] });
    vi.mocked(loadSessionTradeSnapshot).mockResolvedValue(snapshot('Demo Contest Real Owner', { server: 'Demo Contest Real' }));

    mountSnapshotRuntime();
    await flushSnapshot();

    expect(useAppStore.getState().savedAccounts).toContainEqual(foreign);
    const own = useAppStore.getState().savedAccounts.find(account => account.brokerId === brokerA.brokerId);
    expect(own).toBeDefined();
    expect(own).not.toHaveProperty('accountType');
    expect(own).not.toHaveProperty('isLive');
  });

  it('retains the committed broker metadata when broker selection changes during hydration', async () => {
    let resolve!: (value: SessionTradeSnapshot) => void;
    vi.mocked(loadSessionTradeSnapshot).mockReturnValue(new Promise(done => { resolve = done; }));
    const foreign = bookmark('Foreign owner', brokerB.server);
    useAppStore.setState({ savedAccounts: [foreign] });
    mountSnapshotRuntime();
    await flushSnapshot();

    storeBroker(brokerB);
    await act(async () => { resolve(snapshot()); });

    expect(useAppStore.getState().savedAccounts).toContainEqual(foreign);
    expect(useAppStore.getState().savedAccounts).toContainEqual(expect.objectContaining({
      name: 'Current owner', server: brokerA.server,
      brokerId: brokerA.brokerId, serverUrl: brokerA.serverUrl,
    }));
  });

  it.each([
    { login: 200004 },
    { account_login: 200004 },
    { broker_id: brokerB.brokerId },
    { broker_id: brokerA.brokerId.toLowerCase() },
    { account: { login: 200004 } },
    { user: { account: { broker_id: brokerB.brokerId } } },
  ])('does not overwrite saved account metadata when the response names another owner: %j', async conflictingIdentity => {
    const own = { ...bookmark('Known owner', brokerA.server, brokerA), accountType: 'demo' as const, isLive: false };
    useAppStore.setState({ savedAccounts: [own] });
    vi.mocked(loadSessionTradeSnapshot).mockResolvedValue(snapshot('Wrong owner', {
      account_type: 'contest', ...conflictingIdentity,
    }));

    mountSnapshotRuntime();
    await flushSnapshot();

    expect(useAppStore.getState().savedAccounts).toEqual([own]);
  });

  it('rejects a previous broker summary after a same-login session switch', async () => {
    let resolve!: (value: SessionTradeSnapshot) => void;
    vi.mocked(loadSessionTradeSnapshot).mockReturnValue(new Promise(done => { resolve = done; }));
    const accounts = [bookmark('Alpha owner', brokerA.server), bookmark('Beta owner', brokerB.server)];
    useAppStore.setState({ savedAccounts: accounts });
    mountSnapshotRuntime();
    await flushSnapshot();

    storeBroker(brokerB);
    commitBrokerAccountSessionScope({ authenticated: true, accountId: '200003', ...brokerB });
    await act(async () => { resolve(snapshot('Stale owner', { account_type: 'contest' })); });

    expect(useAppStore.getState().savedAccounts).toEqual(accounts);
    expect(useAppStore.getState().account).toBeNull();
  });

  it('does not read or save metadata for an account not matching the committed session', async () => {
    commitBrokerAccountSessionScope({ authenticated: true, accountId: '200004', ...brokerA });

    mountSnapshotRuntime();
    await flushSnapshot();

    expect(loadSessionTradeSnapshot).not.toHaveBeenCalled();
    expect(useAppStore.getState().savedAccounts).toEqual([]);
  });

  it('hydrates margin and freeMargin from metricsResultPromise when account summary only has profile fields', async () => {
    vi.mocked(loadSessionTradeSnapshot).mockResolvedValue({
      ...snapshot('Current owner'),
      metricsResultPromise: Promise.resolve({
        status: 'fulfilled',
        value: {
          balance: 1000,
          equity: 1015,
          used_margin: 42.5,
          free_margin: 972.5,
          margin_level: 2388.24,
          floating_pnl: 15,
          currency: 'USD',
          leverage: 100,
        },
      }),
    });

    mountSnapshotRuntime();
    await flushSnapshot();

    expect(useAppStore.getState().account).toMatchObject({
      balance: 1000,
      equity: 1015,
      margin: 42.5,
      freeMargin: 972.5,
      marginLevel: 2388.24,
      unrealizedPL: 15,
      hasBackendMargin: true,
      hasBackendFreeMargin: true,
      hasBackendMarginLevel: true,
    });
  });

  it('does not wait for a previous account in-flight snapshot when switching accounts', async () => {
    let resolveFirstAccount!: (value: SessionTradeSnapshot) => void;
    vi.mocked(loadSessionTradeSnapshot)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstAccount = resolve;
      }))
      .mockResolvedValueOnce({
        accountResult: {
          status: 'fulfilled',
          value: { id: '200004', balance: 2500, equity: 2500, currency: 'USD', leverage: 100, name: 'Second owner' },
        },
        positionsResult: { status: 'fulfilled', value: [] },
      });

    const accountIdRef = { current: '200003' };
    const isAuthenticatedRef = { current: true };
    const activeAccountDataRef = { current: 200003 as number | null };
    const options: Parameters<typeof useAccountSnapshotRuntime>[0] = {
      isAuthenticated: true,
      accountId: '200003',
      accountIdRef,
      isAuthenticatedRef,
      activeAccountDataRef,
      optimisticClosedTicketsRef: { current: new Set() },
      serverClosedTicketsRef: { current: new Set() },
      positionsStreamVersionRef: { current: 0 },
      beginTradeRestRead: () => ({ startedAt: 1, startedVersion: 0, startedLocalMutationVersion: 0 }),
      isStaleTradeRestRead: () => false,
      reconcileOptimisticClosedPositions: (positions) => positions,
      refreshOrdersAndHistory: vi.fn().mockResolvedValue(undefined),
      refreshPositions: vi.fn().mockResolvedValue(undefined),
      setInitialTradeSnapshotSettledFor: vi.fn(),
    };

    const { rerender } = renderHook(({ accountId }) => useAccountSnapshotRuntime({ ...options, accountId }), {
      initialProps: { accountId: '200003' },
    });
    await flushSnapshot();
    expect(loadSessionTradeSnapshot).toHaveBeenCalledWith(200003);

    accountIdRef.current = '200004';
    commitBrokerAccountSessionScope({ authenticated: true, accountId: '200004', ...brokerA });
    useAppStore.setState({ accountId: '200004', authToken: 'test-token-200004' });
    rerender({ accountId: '200004' });
    await flushSnapshot();

    expect(loadSessionTradeSnapshot).toHaveBeenCalledWith(200004);
    expect(useAppStore.getState().account).toMatchObject({ balance: 2500, equity: 2500 });

    await act(async () => {
      resolveFirstAccount(snapshot('First owner'));
    });
    expect(useAppStore.getState().account).toMatchObject({ balance: 2500, equity: 2500 });
  });
});
