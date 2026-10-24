// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitBrokerAccountSessionScope } from '../../services/brokerSession';
import { beginPositionsRead, isConfirmedClosedPosition, useAppStore, type Position } from '../../store/useAppStore';
import { getLastPositionsStreamFrameAt } from '../../services/positionSnapshotSafety';
import { useTradeStreamRuntime } from './useTradeStreamRuntime';

// Exact NATS payloads stored on RTX5_TRADE_EVENTS for ETHUSD ticket 12065 (seq 70190 and 70191,
// 2026-10-22 08:34:59.506 UTC). The gateway delivers each one as {"channel":"positions.200036","data":<payload>}.
const PAYLOAD_SEQ_70190 = `{"data": {"lots": 0.010000000000000000, "side": "sell", "swap": 0.000000000000000000, "action": "closed", "status": "closed", "symbol": "ETHUSD", "ticket": 12065, "volume": 0.010000000000000000, "comment": "", "price_sl": 2408.110000000000000000, "price_tp": null, "broker_id": "trivanta-markets", "commission": 0.000000000000000000, "price_open": 2399.320000000000000000, "time_create": 1792658095, "time_update": 1792658099, "update_kind": "snapshot", "account_login": 200036, "pnl_available": false, "state_version": "3", "position_ticket": 12065, "realized_profit": -0.090000000000000000, "volume_remaining": 0}, "type": "position_closed", "event_id": "c90d6484-034a-4605-a9c7-d363401b747b", "update_kind": "snapshot"}`;
const PAYLOAD_SEQ_70191 = `{"data": {"side": "sell", "swap": 0, "profit": -0.09, "status": "closed", "symbol": "ETHUSD", "ticket": 12065, "volume": 0.01, "broker_id": "trivanta-markets", "closed_at": 1792658099, "effect_id": "deal:12067", "command_id": null, "attribution": "order_command", "deal_ticket": 12067, "position_id": 12065, "price_close": 2407.96, "ticket_text": "12065", "close_reason": "sl", "account_login": 200036, "realized_swap": 0, "state_version": 3, "volume_closed": 0.01, "client_order_id": "trg-9874c16decbaf595f730aaee0aaa80f22a384eb1", "position_ticket": 12065, "realized_profit": -0.09, "deal_ticket_text": "12067", "position_id_text": "12065", "commission_decimal": "0.00", "state_version_text": "3", "position_ticket_text": "12065"}, "type": "position_closed", "event_id": "bf584f75-05cd-55e3-935c-b856292a2390", "client_order_id": "trg-9874c16decbaf595f730aaee0aaa80f22a384eb1"}`;

const LOGIN = 200036;
const CHANNEL = 'positions.200036';

const openPosition = (overrides: Partial<Position> = {}): Position => ({
  id: 12065,
  symbol: 'ETHUSD',
  side: 'SELL',
  volume: 0.01,
  openPrice: 2399.32,
  currentPrice: 2402.59,
  openTime: '2026-10-22T08:34:55.000Z',
  sl: 2408.11,
  tp: 0,
  swap: 0,
  commission: 0,
  unrealizedPnL: -0.09,
  state_version: '2',
  ...overrides,
} as Position);

describe('trade stream close frames for ticket 12065', () => {
  let handler: ((data: unknown) => void) | undefined;
  const subscribe = vi.fn((_channel: string, callback: (data: unknown) => void) => {
    handler = callback;
    return () => undefined;
  });
  const deliver = (payload: string) => {
    // Same path as the WebSocket text frame: JSON text, parsed, then the channel envelope.
    handler?.({ channel: CHANNEL, data: JSON.parse(payload) });
  };
  const ids = () => useAppStore.getState().positions.map(({ id }) => id);

  beforeEach(() => {
    localStorage.clear();
    useAppStore.getState().reset();
    useAppStore.setState({ accountId: String(LOGIN), isAuthenticated: true });
    handler = undefined;
    subscribe.mockClear();
    renderHook(() => useTradeStreamRuntime({
      isAuthenticated: true,
      subscribe,
      isSessionActive: () => true,
      getAcceptedChannelLogin: (channel?: string) => (channel?.startsWith('positions.') ? LOGIN : null),
      getLiveTradingLogin: () => LOGIN,
      incrementPositionsStreamVersion: vi.fn(),
      hasServerClosedTicket: () => false,
      markServerClosedTickets: vi.fn(),
      markTradeWsMessage: vi.fn(),
      reconcileOptimisticClosedPositions: (positions) => positions,
      refreshOrdersAndHistory: vi.fn(() => Promise.resolve()),
      reloadMarketSymbols: vi.fn(),
    }));
    useAppStore.getState().setPositions([openPosition()], { readStartedAt: beginPositionsRead() });
  });

  it('subscribes to the wildcard feed and holds 12065 open at state_version 2 before the frames', () => {
    expect(subscribe).toHaveBeenCalledWith('*', expect.any(Function));
    expect(handler).toBeDefined();
    expect(ids()).toEqual([12065]);
  });

  it('removes 12065 when seq 70190 arrives (position_closed, update_kind snapshot, state_version "3")', () => {
    deliver(PAYLOAD_SEQ_70190);
    expect(ids()).toEqual([]);
  });

  it('removes 12065 when seq 70191 arrives after 70190 (close_reason sl, numeric state_version 3)', () => {
    deliver(PAYLOAD_SEQ_70190);
    deliver(PAYLOAD_SEQ_70191);
    expect(ids()).toEqual([]);
    expect(isConfirmedClosedPosition(12065)).toBe(true);
  });

  it('removes 12065 when seq 70191 alone arrives', () => {
    deliver(PAYLOAD_SEQ_70191);
    expect(ids()).toEqual([]);
  });

  it('a REST merge right after the frames does not resurrect 12065 from a lagged snapshot', () => {
    deliver(PAYLOAD_SEQ_70190);
    deliver(PAYLOAD_SEQ_70191);
    useAppStore.getState().setPositions([openPosition()], { readStartedAt: beginPositionsRead() });
    expect(ids()).toEqual([]);
  });
});

describe('trade stream close frames under a committed broker session', () => {
  let handler: ((data: unknown) => void) | undefined;
  const subscribe = vi.fn((_channel: string, callback: (data: unknown) => void) => {
    handler = callback;
    return () => undefined;
  });
  const deliver = (payload: string) => {
    handler?.({ channel: CHANNEL, data: JSON.parse(payload) });
  };
  const ids = () => useAppStore.getState().positions.map(({ id }) => id);
  const mount = () => renderHook(() => useTradeStreamRuntime({
    isAuthenticated: true,
    subscribe,
    isSessionActive: () => true,
    getAcceptedChannelLogin: (channel?: string) => (channel?.startsWith('positions.') ? LOGIN : null),
    getLiveTradingLogin: () => LOGIN,
    incrementPositionsStreamVersion: vi.fn(),
    hasServerClosedTicket: () => false,
    markServerClosedTickets: vi.fn(),
    markTradeWsMessage: vi.fn(),
    reconcileOptimisticClosedPositions: (positions) => positions,
    refreshOrdersAndHistory: vi.fn(() => Promise.resolve()),
    reloadMarketSymbols: vi.fn(),
  }));

  beforeEach(() => {
    localStorage.clear();
    useAppStore.getState().reset();
    useAppStore.setState({ accountId: String(LOGIN), isAuthenticated: true });
    handler = undefined;
    subscribe.mockClear();
  });

  afterEach(() => {
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
  });

  it('applies both close frames when the session broker is trivanta-markets (the frames carry broker_id "trivanta-markets")', () => {
    commitBrokerAccountSessionScope({ authenticated: true, accountId: String(LOGIN), brokerId: 'trivanta-markets', serverUrl: 'https://trivanta.test' });
    mount();
    useAppStore.getState().setPositions([openPosition()], { readStartedAt: beginPositionsRead() });

    deliver(PAYLOAD_SEQ_70190);
    deliver(PAYLOAD_SEQ_70191);

    expect(ids()).toEqual([]);
  });

  it('drops the same frames when the session belongs to another broker (isOtherBrokerId gate)', () => {
    commitBrokerAccountSessionScope({ authenticated: true, accountId: String(LOGIN), brokerId: 'other-broker', serverUrl: 'https://other.test' });
    mount();
    useAppStore.getState().setPositions([openPosition()], { readStartedAt: beginPositionsRead() });

    deliver(PAYLOAD_SEQ_70190);
    deliver(PAYLOAD_SEQ_70191);

    expect(ids()).toEqual([12065]);
  });

  it('a pnl-only frame does not stamp the safety net; a close frame does', () => {
    commitBrokerAccountSessionScope({ authenticated: true, accountId: String(LOGIN), brokerId: 'trivanta-markets', serverUrl: 'https://trivanta.test' });
    mount();
    const pnlFrame = JSON.stringify({
      type: 'position_update',
      update_kind: 'pnl',
      ticket: 12063,
      symbol: 'ETHUSD',
      side: 'buy',
      volume: 0.01,
      price_open: 2412.41,
      price_current: 2413,
      profit: -0.08,
      account_login: LOGIN,
      broker_id: 'trivanta-markets',
      state_version: '1',
    });
    const before = getLastPositionsStreamFrameAt();

    deliver(pnlFrame);
    expect(getLastPositionsStreamFrameAt()).toBe(before);

    deliver(PAYLOAD_SEQ_70190);
    expect(getLastPositionsStreamFrameAt()).toBeGreaterThan(before);
  });
});
