// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginPositionsRead,
  isConfirmedClosedBySnapshot,
  RECENT_OPEN_POSITION_RETENTION_MS,
  useAppStore,
  type Position,
} from './useAppStore';

const position = (id: number, overrides: Partial<Position> = {}): Position => ({
  id,
  symbol: 'ETHUSD',
  side: 'SELL',
  volume: 0.01,
  openPrice: 2399.32,
  currentPrice: 2400,
  openTime: '2026-10-22T08:34:55.000Z',
  sl: 0,
  tp: 0,
  swap: 0,
  commission: 0,
  unrealizedPnL: 0,
  ...overrides,
});

const ids = () => useAppStore.getState().positions.map(({ id }) => id).sort((a, b) => a - b);
const recent = () => ({ chartEntryTime: new Date().toISOString() });

describe('complete positions reads: order, touches and closure', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    useAppStore.getState().reset();
  });

  it('an older read that lands after a newer one cannot undo the newer read', () => {
    const older = beginPositionsRead();
    const newer = beginPositionsRead();
    useAppStore.getState().setPositions([position(601)], { readStartedAt: newer });

    // The older read omits 601 (it was opened after the older read started).
    useAppStore.getState().setPositions([], { readStartedAt: older });

    expect(ids()).toEqual([601]);
  });

  it('an older read that lands after a newer closing read cannot resurrect the closed ticket', () => {
    const confirm = beginPositionsRead();
    useAppStore.getState().setPositions([position(602)], { readStartedAt: confirm });
    const older = beginPositionsRead();
    const newer = beginPositionsRead();
    useAppStore.getState().setPositions([], { readStartedAt: newer });

    useAppStore.getState().setPositions([position(602)], { readStartedAt: older });

    expect(ids()).toEqual([]);
    expect(isConfirmedClosedBySnapshot(602)).toBe(true);
  });

  it('a stream write newer than the read keeps its row when the read omits the ticket', () => {
    const confirm = beginPositionsRead();
    useAppStore.getState().setPositions([position(603)], { readStartedAt: confirm });
    const read = beginPositionsRead();
    useAppStore.getState().setPositions([position(603, { currentPrice: 2405 })], { touchedTickets: [603] });

    useAppStore.getState().setPositions([], { readStartedAt: read });

    expect(ids()).toEqual([603]);
    expect(isConfirmedClosedBySnapshot(603)).toBe(false);
  });

  it('an empty complete read closes confirmed rows but keeps a fresh fill no read has confirmed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T08:35:00.000Z'));
    useAppStore.getState().setPositions([position(604)], { readStartedAt: beginPositionsRead() });
    // A fill admitted through the click path passes the full list, as upsertImmediatePosition does.
    useAppStore.getState().setPositions([position(604), position(605, recent())], { touchedTickets: [605] });

    useAppStore.getState().setPositions([], { readStartedAt: beginPositionsRead() });

    expect(ids()).toEqual([605]);
    expect(isConfirmedClosedBySnapshot(604)).toBe(true);
    vi.advanceTimersByTime(RECENT_OPEN_POSITION_RETENTION_MS + 1);
    expect(ids()).toEqual([]);
  });

  it('a later admit of a ticket clears its close marker', () => {
    useAppStore.getState().setPositions([position(606)], { readStartedAt: beginPositionsRead() });
    useAppStore.getState().setPositions([], { readStartedAt: beginPositionsRead() });
    expect(isConfirmedClosedBySnapshot(606)).toBe(true);

    useAppStore.getState().setPositions([position(606)]);

    expect(ids()).toEqual([606]);
    expect(isConfirmedClosedBySnapshot(606)).toBe(false);
  });

  it('a close marker expires after its TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T08:35:00.000Z'));
    useAppStore.getState().setPositions([position(607)], { readStartedAt: beginPositionsRead() });
    useAppStore.getState().setPositions([], { readStartedAt: beginPositionsRead() });
    expect(isConfirmedClosedBySnapshot(607)).toBe(true);

    vi.advanceTimersByTime(5 * 60_000 + 1);

    expect(isConfirmedClosedBySnapshot(607)).toBe(false);
  });
});
