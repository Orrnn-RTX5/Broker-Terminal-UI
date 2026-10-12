// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const storeState = {
    isAuthenticated: true,
    accountId: '200001',
    authToken: 'access-token',
    account: null as any,
    setAccount: vi.fn((account: any) => updateStore({ account })),
    positions: [] as any[],
    setPositions: vi.fn((positions: any[]) => updateStore({ positions })),
  };
  const storeSubscribers = new Set<(state: typeof storeState, previous: typeof storeState) => void>();
  const updateStore = (patch: Partial<typeof storeState>) => {
    const previous = { ...storeState };
    Object.assign(storeState, patch);
    storeSubscribers.forEach(listener => listener(storeState, previous));
  };

  return {
    storeState,
    storeSubscribers,
    updateStore,
    scopeSubscribers: new Set<(scope: any) => void>(),
    sessionScope: 'authenticated|200001|test|https://test.example.com',
    getSessionTradeSnapshotRequests: vi.fn(),
  };
});

vi.mock('../store/useAppStore', async () => {
  const { useSyncExternalStore } = await import('react');
  const useAppStore = Object.assign(
    (selector: (state: typeof mocks.storeState) => unknown) => useSyncExternalStore(
      (listener) => {
        mocks.storeSubscribers.add(listener);
        return () => { mocks.storeSubscribers.delete(listener); };
      },
      () => selector(mocks.storeState),
    ),
    {
      getState: () => mocks.storeState,
      subscribe: (listener: (state: typeof mocks.storeState, previous: typeof mocks.storeState) => void) => {
        mocks.storeSubscribers.add(listener);
        return () => { mocks.storeSubscribers.delete(listener); };
      },
    },
  );
  return { useAppStore, isConfirmedClosedPosition: () => false };
});

vi.mock('../api/tradeGateway', () => ({
  getStoredAccountLogin: () => 200001,
  normalizePosition: (raw: any) => ({
    id: Number(raw.ticket ?? raw.id),
    symbol: String(raw.symbol ?? ''),
    side: String(raw.side ?? '').toLowerCase().includes('sell') ? 'SELL' : 'BUY',
    volume: Number(raw.volume ?? 0),
    openPrice: Number(raw.price_open ?? raw.openPrice ?? 0),
    currentPrice: Number(raw.price_current ?? raw.currentPrice ?? 0),
    openTime: String(raw.time_create ?? raw.openTime ?? ''),
    sl: Number(raw.price_sl ?? raw.sl ?? 0),
    tp: Number(raw.price_tp ?? raw.tp ?? 0),
    swap: Number(raw.swap ?? 0),
    commission: Number(raw.commission ?? 0),
    unrealizedPnL: Number(raw.profit ?? raw.unrealizedPnL ?? 0),
  }),
}));

vi.mock('../services/brokerSession', () => ({
  buildBrokerWsV2Uri: () => 'ws://test.example.com/ws/v2',
  getAccessToken: () => 'access-token',
  getCommittedBrokerAccountSessionScope: () => ({
    authenticated: true,
    accountId: '200001',
    brokerId: 'test',
    serverUrl: 'https://test.example.com',
  }),
  getCommittedBrokerAccountSessionScopeKey: () => mocks.sessionScope,
  onCommittedBrokerAccountSessionScopeChange: (listener: (scope: any) => void) => {
    mocks.scopeSubscribers.add(listener);
    return () => { mocks.scopeSubscribers.delete(listener); };
  },
  getServerUrl: () => 'https://test.example.com',
}));

vi.mock('../services/tradeStartupSnapshot', () => ({
  getSessionTradeSnapshotRequests: mocks.getSessionTradeSnapshotRequests,
}));

vi.mock('../services/tradeOverlayHistory', () => ({
  TRADE_OVERLAY_CLOSE_STATE_EVENT: 'rtx:trade-overlay-close-state',
}));

vi.mock('../services/marketOrderPlacementEvents', () => ({
  MARKET_ORDER_PLACEMENT_STATE_EVENT: 'rtx:market-order-placement-state',
}));

import { useToolboxTradeData } from './useToolboxTradeData';
import type { MarketOrderPlacementStateDetail } from '../services/marketOrderPlacementEvents';

const rawPosition = {
  ticket: 17,
  symbol: 'EURUSD',
  side: 'buy',
  volume: 0.1,
  price_open: 1.1,
  price_current: 1.101,
  time_create: '2026-09-02T10:00:00.000Z',
  profit: 10,
};

class IdleWebSocket {
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();
}

describe('useToolboxTradeData display lifecycle', () => {
  beforeEach(() => {
    mocks.storeState.isAuthenticated = true;
    mocks.storeState.accountId = '200001';
    mocks.storeState.authToken = 'access-token';
    mocks.storeState.account = null;
    mocks.storeState.positions = [];
    mocks.storeSubscribers.clear();
    mocks.scopeSubscribers.clear();
    mocks.sessionScope = 'authenticated|200001|test|https://test.example.com';
    mocks.storeState.setPositions.mockClear();
    mocks.getSessionTradeSnapshotRequests.mockReset();
    vi.stubGlobal('WebSocket', IdleWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns same-session store positions on the first render', () => {
    mocks.storeState.positions = [rawPosition];
    mocks.getSessionTradeSnapshotRequests.mockReturnValue({
      positionsResultPromise: new Promise(() => undefined),
      accountResultPromise: new Promise(() => undefined),
      snapshotPromise: new Promise(() => undefined),
    });
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));

    const { result, unmount } = renderHook(() => useToolboxTradeData());

    expect(result.current.positions).toEqual([
      expect.objectContaining({ id: 17, ticket: 17, symbol: 'EURUSD' }),
    ]);
    expect(result.current.loading).toBe(false);
    unmount();
  });

  it('keeps a closing row until the backend confirms the close (MT5 behaviour)', () => {
    mocks.storeState.positions = [rawPosition];
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    const dispatchCloseState = (status: 'confirmed' | 'failed') => act(() => {
      window.dispatchEvent(new CustomEvent('rtx:trade-overlay-close-state', {
        detail: { status, ticketIds: ['17'] },
      }));
    });

    const { result, unmount } = renderHook(() => useToolboxTradeData());
    expect(result.current.positions.map((position) => position.id)).toEqual([17]);

    dispatchCloseState('failed');
    expect(result.current.positions.map((position) => position.id)).toEqual([17]);

    dispatchCloseState('confirmed');
    expect(result.current.positions).toEqual([]);
    unmount();
  });

  it('does not start a duplicate REST snapshot or raw WebSocket', () => {
    const fetchSpy = vi.fn();
    const webSocketSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('WebSocket', webSocketSpy);

    const { unmount } = renderHook(() => useToolboxTradeData());

    expect(mocks.getSessionTradeSnapshotRequests).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(webSocketSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('renders one authoritative account/position update once without first painting old rows', () => {
    mocks.storeState.positions = [rawPosition];
    const visibleRenders: { equity: number | undefined; profit: number | undefined }[] = [];
    const { result, unmount } = renderHook(() => {
      const trade = useToolboxTradeData();
      visibleRenders.push({ equity: trade.account?.equity, profit: trade.positions[0]?.profit });
      return trade;
    });
    visibleRenders.length = 0;

    act(() => mocks.updateStore({
      account: { equity: 1022, publicationToken: 'snapshot-2' },
      positions: [{ ...rawPosition, profit: 22 }],
    }));

    expect(visibleRenders).toEqual([{ equity: 1022, profit: 22 }]);
    expect(result.current.positions[0]).toMatchObject({ id: 17, profit: 22 });
    unmount();
  });

  it('keeps row identities for account-only packets and ignores identical displayed snapshots', () => {
    mocks.storeState.positions = [rawPosition];
    mocks.storeState.account = { equity: 1010, publicationToken: 'snapshot-1' };
    const committed = vi.fn();
    const { result, unmount } = renderHook(() => {
      const trade = useToolboxTradeData();
      useLayoutEffect(() => { committed(); });
      return trade;
    });
    const positions = result.current.positions;
    committed.mockClear();
    act(() => mocks.updateStore({ account: { equity: 1020, publicationToken: 'snapshot-2' } }));
    expect(committed).toHaveBeenCalledOnce();
    expect(result.current.account).toMatchObject({ equity: 1020, publicationToken: 'snapshot-2' });
    expect(result.current.positions).toBe(positions);

    committed.mockClear();
    act(() => mocks.updateStore({ account: { ...mocks.storeState.account }, positions: [{ ...rawPosition }] }));
    expect(committed).not.toHaveBeenCalled();
    expect(result.current.positions).toBe(positions);
    unmount();
  });

  it('does not normalize rows again for account-only packets', () => {
    const readSymbol = vi.fn(() => 'EURUSD');
    mocks.storeState.positions = [{ ...rawPosition, get symbol() { return readSymbol(); } }];
    const { unmount } = renderHook(() => useToolboxTradeData());
    readSymbol.mockClear();

    act(() => mocks.updateStore({ account: { equity: 1050, publicationToken: 'snapshot-2' } }));

    expect(readSymbol).not.toHaveBeenCalled();
    unmount();
  });

  it('rejects old broker callbacks and disposes the direct stream subscription', () => {
    mocks.storeState.positions = [rawPosition];
    const { result, unmount } = renderHook(() => useToolboxTradeData());
    const positions = result.current.positions;
    const callbacks = [...mocks.storeSubscribers];
    mocks.sessionScope = 'authenticated|200001|other|https://other.example.com';

    act(() => mocks.updateStore({ positions: [{ ...rawPosition, ticket: 18 }] }));
    expect(result.current.positions).toBe(positions);
    unmount();
    expect(mocks.storeSubscribers.size).toBe(0);
    act(() => callbacks.forEach(callback => callback(mocks.storeState, mocks.storeState)));
    expect(result.current.positions).toBe(positions);
  });

  it('rebinds a broker scope change with the same login and token and clears old pending rows', () => {
    const { result, unmount } = renderHook(() => useToolboxTradeData());
    act(() => window.dispatchEvent(new CustomEvent('rtx:market-order-placement-state', {
      detail: {
        login: 200001, sessionScope: mocks.sessionScope, clientOrderId: 'old-broker-order',
        provisionalTicket: -101, status: 'pending', position: { ...rawPosition, ticket: -101 },
      },
    })));
    expect(result.current.pendingPositions).toHaveLength(1);

    act(() => {
      mocks.sessionScope = 'authenticated|200001|other|https://other.example.com';
      mocks.updateStore({ account: null, positions: [] });
      mocks.scopeSubscribers.forEach(listener => listener({}));
    });
    expect(result.current.pendingPositions).toEqual([]);
    act(() => mocks.updateStore({
      account: { equity: 2000, publicationToken: 'other-broker-snapshot' },
      positions: [{ ...rawPosition, ticket: 18 }],
    }));
    expect(result.current.account).toMatchObject({ equity: 2000, publicationToken: 'other-broker-snapshot' });
    expect(result.current.positions.map(position => position.id)).toEqual([18]);
    unmount();
    expect(mocks.scopeSubscribers.size).toBe(0);
  });

  it.each(['rejected', 'expired'] as const)('updates normalized pending rows through %s without affecting another order', (terminalStatus) => {
    const scope = 'authenticated|200001|test|https://test.example.com';
    const first = {
      login: 200001,
      sessionScope: scope,
      clientOrderId: 'order-one',
      provisionalTicket: -101,
    };
    const second = { ...first, clientOrderId: 'order-two', provisionalTicket: -102 };
    const emit = (detail: MarketOrderPlacementStateDetail) => act(() => {
      window.dispatchEvent(new CustomEvent('rtx:market-order-placement-state', { detail }));
    });
    const { result, unmount } = renderHook(() => useToolboxTradeData());
    for (const order of [first, second]) {
      emit({ ...order, status: 'pending', position: { ...rawPosition, ticket: order.provisionalTicket } });
    }
    expect(result.current.pendingPositions).toHaveLength(2);
    const otherPending = result.current.pendingPositions.find((row) => row.clientOrderId === second.clientOrderId);
    const firstRow = () => result.current.pendingPositions.find((row) => row.clientOrderId === first.clientOrderId);

    // A late response from another account or broker session must not settle it.
    emit({ ...first, status: 'rejected', login: 200002, errorCode: 'WRONG_ACCOUNT' });
    emit({ ...first, status: 'rejected', sessionScope: 'old-broker-session', errorCode: 'WRONG_SESSION' });
    expect(firstRow()).toMatchObject({ placementState: 'pending' });
    expect(firstRow()?.placementErrorCode).toBeUndefined();

    for (const status of ['accepted', 'processing'] as const) {
      emit({ ...first, status });
      expect(firstRow()).toMatchObject({ placementState: status, id: first.provisionalTicket });
      expect(result.current.pendingPositions.find((row) => row.clientOrderId === second.clientOrderId)).toBe(otherPending);
    }
    const errorCode = terminalStatus === 'rejected' ? 'TOO_MANY_ORDERS' : 'ORDER_COMMAND_EXPIRED';
    const errorMessage = terminalStatus === 'rejected'
      ? 'Too many orders are already in flight for this account'
      : 'No terminal order result arrived before execute_before.';
    emit({ ...first, status: terminalStatus, errorCode, errorMessage });
    expect(firstRow()).toMatchObject({
      placementState: terminalStatus,
      placementErrorCode: errorCode,
      placementErrorMessage: errorMessage,
    });
    expect(result.current.positions).toEqual([]);
    expect(mocks.storeState.setPositions).not.toHaveBeenCalled();

    emit({ ...second, status: 'filled', position: { ...rawPosition, ticket: 18 } });
    expect(result.current.pendingPositions).toEqual([expect.objectContaining({
      clientOrderId: first.clientOrderId,
      placementState: terminalStatus,
      placementErrorMessage: errorMessage,
    })]);
    expect(result.current.positions).toEqual([expect.objectContaining({
      id: 18,
      clientOrderId: second.clientOrderId,
      placementState: 'filled',
    })]);
    unmount();
  });

  it('keeps pushed SLTP and profit when an older REST snapshot finishes later', async () => {
    mocks.storeState.positions = [{ ...rawPosition, id: 17, sl: 0, tp: 0 }];
    let resolvePositions!: (value: unknown) => void;
    mocks.getSessionTradeSnapshotRequests.mockReturnValue({
      positionsResultPromise: new Promise((resolve) => { resolvePositions = resolve; }),
      accountResultPromise: Promise.resolve({ status: 'fulfilled', value: {} }),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' }));
    const { result, unmount } = renderHook(() => useToolboxTradeData());
    let request!: Promise<void>;
    act(() => { request = result.current.refresh(); });
    mocks.storeState.positions = [{ ...rawPosition, id: 17, sl: 1.05, tp: 1.2, profit: 22 }];
    await act(async () => {
      resolvePositions({ status: 'fulfilled', value: [{ ...rawPosition, price_sl: 0, price_tp: 0, profit: 1 }] });
      await request;
    });
    expect(result.current.positions[0]).toMatchObject({ sl: 1.05, tp: 1.2, profit: 22 });
    unmount();
  });
});
