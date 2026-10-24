// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { beginPositionsRead, useAppStore, type Position } from '../../store/useAppStore';
import { useTradeStreamRuntime } from './useTradeStreamRuntime';
import {
  STREAM_CLOSE_FALLBACK_MS,
  STREAM_HISTORY_LEAD_MS,
  STREAM_HISTORY_WINDOW_MS,
} from './tradeHistoryFreshness';

// Same NATS close payloads as useTradeStreamRuntime.closeFrames.test.ts (ETHUSD ticket 12065).
const PAYLOAD_CLOSED = `{"data": {"lots": 0.010000000000000000, "side": "sell", "action": "closed", "status": "closed", "symbol": "ETHUSD", "ticket": 12065, "volume": 0.010000000000000000, "broker_id": "trivanta-markets", "price_open": 2399.320000000000000000, "time_create": 1792658095, "time_update": 1792658099, "update_kind": "snapshot", "account_login": 200036, "pnl_available": false, "state_version": "3", "position_ticket": 12065, "realized_profit": -0.090000000000000000, "volume_remaining": 0}, "type": "position_closed", "event_id": "c90d6484-034a-4605-a9c7-d363401b747b", "update_kind": "snapshot"}`;

const LOGIN = 200036;
const POSITIONS_CHANNEL = `positions.${LOGIN}`;

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

describe('stream-driven history refetch', () => {
  let handler: ((message: unknown) => void) | undefined;
  let refreshOrdersAndHistory: Mock<(login?: number) => Promise<void>>;
  let liveLogin: number;
  let unmount: (() => void) | undefined;
  const subscribe = vi.fn((_channel: string, callback: (data: unknown) => void) => {
    handler = callback;
    return () => undefined;
  });
  const deliver = (channel: string, payload: unknown) => {
    handler?.({ channel, data: payload });
  };
  const deliverClose = () => deliver(POSITIONS_CHANNEL, JSON.parse(PAYLOAD_CLOSED));
  const deliverOrderFrame = (ticket: number) => deliver(`orders.${LOGIN}`, {
    type: 'order_update',
    data: { ticket, symbol: 'ETHUSD', state_version: 2 },
  });
  const deliverDealFrame = (ticket: number) => deliver(`deals.${LOGIN}`, {
    type: 'deal_add',
    data: { ticket, symbol: 'ETHUSD', position_id: 12065 },
  });

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    useAppStore.getState().reset();
    useAppStore.setState({ accountId: String(LOGIN), isAuthenticated: true });
    handler = undefined;
    liveLogin = LOGIN;
    subscribe.mockClear();
    refreshOrdersAndHistory = vi.fn((_login?: number) => Promise.resolve());
    const mounted = renderHook(() => useTradeStreamRuntime({
      isAuthenticated: true,
      subscribe,
      isSessionActive: () => true,
      getAcceptedChannelLogin: (channel?: string) => (
        channel?.startsWith('positions.') || channel?.startsWith('orders.') || channel?.startsWith('deals.') ? LOGIN : null
      ),
      getLiveTradingLogin: () => liveLogin,
      incrementPositionsStreamVersion: vi.fn(),
      hasServerClosedTicket: () => false,
      markServerClosedTickets: vi.fn(),
      markTradeWsMessage: vi.fn(),
      reconcileOptimisticClosedPositions: (positions) => positions,
      refreshOrdersAndHistory,
      reloadMarketSymbols: vi.fn(),
    }));
    unmount = mounted.unmount;
    useAppStore.getState().setPositions([openPosition()], { readStartedAt: beginPositionsRead() });
  });

  afterEach(() => {
    unmount?.();
    unmount = undefined;
    vi.useRealTimers();
  });

  it('a position_closed frame refetches once after the lead delay, then once more from the close fallback', () => {
    deliverClose();
    vi.advanceTimersByTime(STREAM_HISTORY_LEAD_MS - 1);
    expect(refreshOrdersAndHistory).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refreshOrdersAndHistory).toHaveBeenCalledTimes(1);
    expect(refreshOrdersAndHistory).toHaveBeenLastCalledWith(LOGIN);

    vi.advanceTimersByTime(STREAM_CLOSE_FALLBACK_MS - STREAM_HISTORY_LEAD_MS - 1);
    expect(refreshOrdersAndHistory).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(refreshOrdersAndHistory).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(STREAM_CLOSE_FALLBACK_MS * 4);
    expect(refreshOrdersAndHistory).toHaveBeenCalledTimes(2);
  });

  it('a burst of close, order and deal frames coalesces into one leading refetch', () => {
    deliverClose();
    deliverOrderFrame(12065);
    deliverDealFrame(12067);
    vi.advanceTimersByTime(STREAM_HISTORY_LEAD_MS);
    expect(refreshOrdersAndHistory).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(STREAM_CLOSE_FALLBACK_MS - STREAM_HISTORY_LEAD_MS);
    // The close fallback adds one more, bounded by the last close frame; no trailing refetch.
    expect(refreshOrdersAndHistory).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(STREAM_HISTORY_WINDOW_MS * 4);
    expect(refreshOrdersAndHistory).toHaveBeenCalledTimes(2);
  });

  it('a frame that lands inside the lead lag window re-arms one trailing refetch 250 ms after the last frame', () => {
    deliverOrderFrame(12065);
    vi.advanceTimersByTime(30);
    deliverOrderFrame(12066);
    vi.advanceTimersByTime(STREAM_HISTORY_LEAD_MS - 30);
    expect(refreshOrdersAndHistory).toHaveBeenCalledTimes(1);

    // Last frame at +30, so the trailing refetch is due at +280.
    vi.advanceTimersByTime(STREAM_HISTORY_WINDOW_MS - 21);
    expect(refreshOrdersAndHistory).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(refreshOrdersAndHistory).toHaveBeenCalledTimes(2);
  });

  it('a tail frame at +245 ms gets a later refetch 250 ms after it', () => {
    deliverOrderFrame(12065);
    vi.advanceTimersByTime(245);
    expect(refreshOrdersAndHistory).toHaveBeenCalledTimes(1);

    deliverOrderFrame(12066);
    vi.advanceTimersByTime(STREAM_HISTORY_WINDOW_MS - 1);
    expect(refreshOrdersAndHistory).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(refreshOrdersAndHistory).toHaveBeenCalledTimes(2);
  });

  it('pnl-only position frames update the store and do not refetch history', () => {
    deliver(POSITIONS_CHANNEL, {
      type: 'pnl_update',
      positions: [{
        ticket: 12065,
        update_kind: 'pnl',
        state_version: '2',
        profit: -0.05,
        price_current: 2402.6,
        price_time_msc: 2000,
      }],
    });
    vi.advanceTimersByTime(STREAM_CLOSE_FALLBACK_MS * 2);

    expect(useAppStore.getState().positions[0]).toMatchObject({ id: 12065, profit: -0.05 });
    expect(refreshOrdersAndHistory).not.toHaveBeenCalled();
  });

  it('a login switch mid-window does not refetch the old login', () => {
    deliverClose();
    vi.advanceTimersByTime(10);
    liveLogin = LOGIN + 1;
    vi.advanceTimersByTime(STREAM_CLOSE_FALLBACK_MS * 2);

    expect(refreshOrdersAndHistory).not.toHaveBeenCalled();
  });

  it('unmount with a pending refetch flushes it once and leaves no timers behind', () => {
    deliverClose();
    vi.advanceTimersByTime(10);
    unmount?.();
    unmount = undefined;
    expect(refreshOrdersAndHistory).toHaveBeenCalledTimes(1);
    expect(refreshOrdersAndHistory).toHaveBeenLastCalledWith(LOGIN);

    vi.advanceTimersByTime(STREAM_CLOSE_FALLBACK_MS * 4);
    expect(refreshOrdersAndHistory).toHaveBeenCalledTimes(1);
  });

  it('unmount after the burst has settled leaves nothing to flush or fire', () => {
    deliverOrderFrame(12065);
    vi.advanceTimersByTime(STREAM_HISTORY_LEAD_MS);
    expect(refreshOrdersAndHistory).toHaveBeenCalledTimes(1);
    unmount?.();
    unmount = undefined;

    vi.advanceTimersByTime(STREAM_CLOSE_FALLBACK_MS * 4);
    expect(refreshOrdersAndHistory).toHaveBeenCalledTimes(1);
  });
});
