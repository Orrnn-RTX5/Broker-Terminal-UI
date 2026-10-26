// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../services/api';
import { markPositionsStreamFrameIfStructural, POSITIONS_SAFETY_QUIET_MS, POSITIONS_SAFETY_READ_INTERVAL_MS } from '../../services/positionSnapshotSafety';
import { useAppStore } from '../../store/useAppStore';
import { startPositionsSafetyNet } from './positionsSafetyNet';
import { useTradeRefreshController } from './useTradeRefreshController';

vi.mock('../../services/api', () => ({
  api: {
    positions: { getPositions: vi.fn() },
    orders: { getPendingOrders: vi.fn(async () => []) },
  },
}));
vi.mock('../../services/terminalHistory', () => ({
  beginTradeHistoryRefresh: vi.fn(),
}));
vi.mock('./orderHistoryRefresh', () => ({
  fetchOrderHistory: vi.fn(async () => ({ trades: [], warning: null })),
  getErrorMessage: vi.fn((_error: unknown, fallback: string) => fallback),
}));

const LOGIN = 200036;

describe('positions safety net scheduling', () => {
  let read: ReturnType<typeof vi.fn<() => void>>;
  let visible: boolean;
  let inFlight: boolean;
  let frameAt: number;
  let stop: () => void;

  const setVisible = (value: boolean) => {
    visible = value;
    document.dispatchEvent(new Event('visibilitychange'));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T09:00:00.000Z'));
    read = vi.fn();
    visible = true;
    inFlight = false;
    frameAt = 0;
    stop = startPositionsSafetyNet({
      read,
      isVisible: () => visible,
      isReadInFlight: () => inFlight,
      lastFrameAt: () => frameAt,
    });
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it('fires one complete read after the 30 s interval, then once per interval', () => {
    expect(POSITIONS_SAFETY_READ_INTERVAL_MS).toBe(30_000);
    vi.advanceTimersByTime(POSITIONS_SAFETY_READ_INTERVAL_MS - 1);
    expect(read).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(read).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(POSITIONS_SAFETY_READ_INTERVAL_MS);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('skips the tick while a positions read is in flight and runs on the next free tick', () => {
    inFlight = true;
    vi.advanceTimersByTime(POSITIONS_SAFETY_READ_INTERVAL_MS);
    expect(read).not.toHaveBeenCalled();

    inFlight = false;
    vi.advanceTimersByTime(POSITIONS_SAFETY_READ_INTERVAL_MS);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('skips the tick when a stream positions frame arrived within the quiet window', () => {
    expect(POSITIONS_SAFETY_QUIET_MS).toBe(5_000);
    vi.advanceTimersByTime(27_000);
    frameAt = Date.now();

    vi.advanceTimersByTime(3_000); // tick at 30 s: the frame is 3 s old
    expect(read).not.toHaveBeenCalled();

    vi.advanceTimersByTime(POSITIONS_SAFETY_READ_INTERVAL_MS); // tick at 60 s: the frame is 33 s old
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('stops while the page is hidden and resumes when it is visible again', () => {
    setVisible(false);
    vi.advanceTimersByTime(POSITIONS_SAFETY_READ_INTERVAL_MS * 3);
    expect(read).not.toHaveBeenCalled();

    setVisible(true);
    vi.advanceTimersByTime(POSITIONS_SAFETY_READ_INTERVAL_MS);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('stops when the returned stop runs (logout or account change)', () => {
    stop();
    vi.advanceTimersByTime(POSITIONS_SAFETY_READ_INTERVAL_MS * 2);
    expect(read).not.toHaveBeenCalled();
  });
});

describe('positions safety net against the real refresh path', () => {
  const ROW_12063 = { ticket: 12063, account_login: LOGIN, broker_id: 'trivanta-markets', symbol: 'ETHUSD', side: 'buy', volume: 0.01, price_open: 2412.41, price_current: 2413, profit: 0, price_sl: 0, price_tp: 0, state_version: '1' };
  const ROW_12065 = { ticket: 12065, account_login: LOGIN, broker_id: 'trivanta-markets', symbol: 'ETHUSD', side: 'sell', volume: 0.01, price_open: 2399.32, price_current: 2400, profit: 0, price_sl: 0, price_tp: 0, state_version: '2' };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T09:00:00.000Z'));
    vi.clearAllMocks();
    useAppStore.getState().reset();
    useAppStore.setState({ accountId: String(LOGIN), authToken: 'session-a', isAuthenticated: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a confirmed ticket that the periodic complete read omits is removed', async () => {
    const accountIdRef = { current: String(LOGIN) };
    const isAuthenticatedRef = { current: true };
    const positionsStreamVersionRef = { current: 0 };
    const { result } = renderHook(() => useTradeRefreshController({
      getLiveTradingLogin: () => LOGIN,
      beginTradeRestRead: () => ({ startedAt: Date.now(), startedVersion: 0, startedLocalMutationVersion: 0 }),
      isStaleTradeRestRead: () => false,
      reconcileOptimisticClosedPositions: (positions) => positions,
      accountIdRef,
      isAuthenticatedRef,
      positionsStreamVersionRef,
    }));

    // A complete read confirms both tickets.
    vi.mocked(api.positions.getPositions).mockResolvedValueOnce([ROW_12063, ROW_12065] as never);
    await act(async () => { await result.current.refreshPositions(LOGIN); });
    expect(useAppStore.getState().positions.map(({ id }) => id).sort()).toEqual([12063, 12065]);

    // The close frame for 12065 was lost. The periodic read is the only thing that can notice.
    vi.mocked(api.positions.getPositions).mockResolvedValueOnce([ROW_12063] as never);
    const stopNet = startPositionsSafetyNet({
      read: () => { void result.current.refreshPositions(LOGIN, { allowWsCommit: true }); },
      isVisible: () => true,
      lastFrameAt: () => 0,
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(POSITIONS_SAFETY_READ_INTERVAL_MS); });
    stopNet();

    expect(api.positions.getPositions).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().positions.map(({ id }) => id)).toEqual([12063]);
  });

  it('a stream frame inside the quiet window keeps the periodic read from running', async () => {
    const accountIdRef = { current: String(LOGIN) };
    const isAuthenticatedRef = { current: true };
    const positionsStreamVersionRef = { current: 0 };
    const { result } = renderHook(() => useTradeRefreshController({
      getLiveTradingLogin: () => LOGIN,
      beginTradeRestRead: () => ({ startedAt: Date.now(), startedVersion: 0, startedLocalMutationVersion: 0 }),
      isStaleTradeRestRead: () => false,
      reconcileOptimisticClosedPositions: (positions) => positions,
      accountIdRef,
      isAuthenticatedRef,
      positionsStreamVersionRef,
    }));
    vi.mocked(api.positions.getPositions).mockResolvedValue([ROW_12063] as never);
    markPositionsStreamFrameIfStructural([{ update_kind: 'snapshot' }], [], Date.now() + POSITIONS_SAFETY_READ_INTERVAL_MS - 1_000);

    const stopNet = startPositionsSafetyNet({
      read: () => { void result.current.refreshPositions(LOGIN, { allowWsCommit: true }); },
      isVisible: () => true,
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(POSITIONS_SAFETY_READ_INTERVAL_MS); });
    stopNet();

    expect(api.positions.getPositions).not.toHaveBeenCalled();
  });
  describe('stream frames and the safety read', () => {
    beforeEach(() => {
      // Frames stamped by earlier tests sit on the earlier fake clock; keep this clock past them.
      vi.setSystemTime(new Date('2026-10-22T11:00:00.000Z'));
    });

    const mountController = () => renderHook(() => useTradeRefreshController({
      getLiveTradingLogin: () => LOGIN,
      beginTradeRestRead: () => ({ startedAt: Date.now(), startedVersion: 0, startedLocalMutationVersion: 0 }),
      isStaleTradeRestRead: () => false,
      reconcileOptimisticClosedPositions: (positions) => positions,
      accountIdRef: { current: String(LOGIN) },
      isAuthenticatedRef: { current: true },
      positionsStreamVersionRef: { current: 0 },
    }));

    // A complete read confirms 12063 and 12065; the next complete read omits 12065.
    const confirmBothTickets = async (result: { current: ReturnType<typeof useTradeRefreshController> }) => {
      vi.mocked(api.positions.getPositions).mockResolvedValueOnce([ROW_12063, ROW_12065] as never);
      await act(async () => { await result.current.refreshPositions(LOGIN); });
      vi.mocked(api.positions.getPositions).mockResolvedValue([ROW_12063] as never);
    };

    it('a pnl-only frame every second does not hold the safety read off: it fires at 30 s and removes the omitted confirmed ticket', async () => {
      const { result } = mountController();
      await confirmBothTickets(result);
      const stopNet = startPositionsSafetyNet({
        read: () => { void result.current.refreshPositions(LOGIN, { allowWsCommit: true }); },
        isVisible: () => true,
      });

      for (let second = 1; second < POSITIONS_SAFETY_READ_INTERVAL_MS / 1_000; second += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
        markPositionsStreamFrameIfStructural([{ ticket: 12063, update_kind: 'pnl' } as { update_kind?: unknown }], []);
      }
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      stopNet();

      expect(api.positions.getPositions).toHaveBeenCalledTimes(2);
      expect(useAppStore.getState().positions.map(({ id }) => id)).toEqual([12063]);
    });

    it('a structural frame inside the quiet window still delays the safety read', async () => {
      const { result } = mountController();
      await confirmBothTickets(result);
      const stopNet = startPositionsSafetyNet({
        read: () => { void result.current.refreshPositions(LOGIN, { allowWsCommit: true }); },
        isVisible: () => true,
      });

      await act(async () => { await vi.advanceTimersByTimeAsync(27_000); });
      markPositionsStreamFrameIfStructural([{ ticket: 12065, update_kind: 'snapshot' } as { update_kind?: unknown }], []);
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000); }); // 30 s: the structural frame is 3 s old
      expect(api.positions.getPositions).toHaveBeenCalledTimes(1);

      await act(async () => { await vi.advanceTimersByTimeAsync(POSITIONS_SAFETY_READ_INTERVAL_MS); }); // 60 s
      stopNet();
      expect(api.positions.getPositions).toHaveBeenCalledTimes(2);
    });
  });
});
