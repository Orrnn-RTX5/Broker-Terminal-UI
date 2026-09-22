// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
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
  return { useAppStore };
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
});
