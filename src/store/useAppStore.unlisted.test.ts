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

describe('fills a complete read did not list', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    useAppStore.getState().reset();
  });

  it('keeps a retained fill the REST response did not list through a later complete read that omits it, until retention ends', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T08:35:00.000Z'));
    const fill = position(606, { chartEntryTime: new Date().toISOString() });
    // Toolbox commit: REST listed 12063 only; the retained fill 606 was not in the response.
    useAppStore.getState().setPositions([position(12063), fill], {
      readStartedAt: beginPositionsRead(),
      unlistedTickets: [606],
    });

    // Server lag: the next complete read omits 606 too.
    useAppStore.getState().setPositions([position(12063)], { readStartedAt: beginPositionsRead() });
    expect(ids()).toEqual([606, 12063]);
    expect(isConfirmedClosedBySnapshot(606)).toBe(false);

    vi.advanceTimersByTime(RECENT_OPEN_POSITION_RETENTION_MS + 1);
    expect(ids()).toEqual([12063]);
  });

  it('still confirms every ticket the read did list, so a listed ticket omitted later is closed at once', () => {
    useAppStore.getState().setPositions([position(12063), position(607, { chartEntryTime: new Date().toISOString() })], {
      readStartedAt: beginPositionsRead(),
      unlistedTickets: [607],
    });
    useAppStore.getState().setPositions([position(607)], { readStartedAt: beginPositionsRead() });

    expect(ids()).toEqual([607]);
    useAppStore.getState().setPositions([], { readStartedAt: beginPositionsRead() });
    expect(ids()).toEqual([]);
    expect(isConfirmedClosedBySnapshot(12063)).toBe(true);
  });
});
