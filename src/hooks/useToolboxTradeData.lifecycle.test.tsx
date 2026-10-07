// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const storeState = {
    isAuthenticated: true,
    accountId: '200001',
    authToken: 'access-token',
    account: null as any,
    setAccount: vi.fn((account: any) => { storeState.account = account; }),
    positions: [] as any[],
    setPositions: vi.fn((positions: any[]) => {
      storeState.positions = positions;
    }),
  };

  return {
    storeState,
    getSessionTradeSnapshotRequests: vi.fn(),
  };
});

vi.mock('../store/useAppStore', () => {
  const useAppStore = Object.assign(
    (selector: (state: typeof mocks.storeState) => unknown) => selector(mocks.storeState),
    {
      getState: () => mocks.storeState,
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
  getCommittedBrokerAccountSessionScopeKey: () => 'authenticated|200001|test|https://test.example.com',
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
    mocks.storeState.setPositions.mockClear();
    mocks.getSessionTradeSnapshotRequests.mockReset();
    vi.stubGlobal('WebSocket', IdleWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
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

  const dispatchPlacement = (status: string, clientOrderId = 'order-one') => act(() => {
    window.dispatchEvent(new CustomEvent('rtx:market-order-placement-state', {
      detail: {
        status, clientOrderId, login: 200001,
        sessionScope: 'authenticated|200001|test|https://test.example.com',
        provisionalTicket: -17,
        ...(status === 'pending' ? { position: { ...rawPosition, ticket: -17, client_order_id: clientOrderId } } : {}),
      },
    }));
  });

  it('replaces a provisional row when the matching fill arrives through the shared position stream', () => {
    const { result, rerender, unmount } = renderHook(() => useToolboxTradeData());
    dispatchPlacement('pending');
    expect(result.current.pendingPositions).toHaveLength(1);
    mocks.storeState.positions = [{ ...rawPosition, client_order_id: 'different-order' }];
    rerender();
    expect(result.current.pendingPositions).toHaveLength(1);
    mocks.storeState.positions = [{ ...rawPosition, client_order_id: 'order-one' }];
    rerender();
    expect(result.current.pendingPositions).toEqual([]);
    expect(result.current.positions[0].id).toBe(17);
    unmount();
  });

  it('does not recreate a pending row when the authoritative fill arrived first', () => {
    mocks.storeState.positions = [{ ...rawPosition, client_order_id: 'order-one' }];
    const { result, unmount } = renderHook(() => useToolboxTradeData());
    dispatchPlacement('pending');
    expect(result.current.pendingPositions).toEqual([]);
    expect(result.current.positions[0].id).toBe(17);
    unmount();
  });

  it('keeps an unresolved command visible after its deadline and resolves it on a later authoritative fill', () => {
    vi.useFakeTimers();
    const { result, rerender, unmount } = renderHook(() => useToolboxTradeData());
    dispatchPlacement('pending');
    act(() => vi.advanceTimersByTime(120_000));
    expect(result.current.pendingPositions[0]).toMatchObject({
      placementState: 'pending', placementErrorCode: 'ORDER_OUTCOME_UNKNOWN',
    });
    expect(result.current.pendingPositions[0].placementErrorMessage).toContain('order-one');
    act(() => vi.advanceTimersByTime(120_000));
    expect(result.current.pendingPositions).toHaveLength(1);
    mocks.storeState.positions = [{ ...rawPosition, client_order_id: 'order-one' }];
    rerender();
    expect(result.current.pendingPositions).toEqual([]);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['rejected', 'expired'])('retains a known %s result briefly and then removes only that terminal placeholder', (status) => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useToolboxTradeData());
    dispatchPlacement('pending');
    dispatchPlacement(status);
    expect(result.current.pendingPositions[0].placementState).toBe(status);
    act(() => vi.advanceTimersByTime(120_000));
    expect(result.current.pendingPositions).toEqual([]);
    expect(result.current.positions).toEqual([]);
    unmount();
  });

  it('reconciles a missed terminal callback from the REST position snapshot', async () => {
    mocks.getSessionTradeSnapshotRequests.mockReturnValue({
      positionsResultPromise: Promise.resolve({ status: 'fulfilled', value: [{ ...rawPosition, client_order_id: 'order-one' }] }),
      accountResultPromise: Promise.resolve({ status: 'fulfilled', value: {} }),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' }));
    const { result, unmount } = renderHook(() => useToolboxTradeData());
    dispatchPlacement('pending');
    await act(async () => { await result.current.refresh(); });
    expect(result.current.pendingPositions).toEqual([]);
    expect(result.current.positions[0].id).toBe(17);
    unmount();
  });
});
