// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import { type Position, useAppStore } from './useAppStore';

const position = (id: number, overrides: Partial<Position> = {}): Position => ({
  id,
  symbol: 'BTCUSD',
  side: 'BUY',
  volume: 0.01,
  openPrice: 80_000 + id,
  currentPrice: 80_001 + id,
  openTime: '2026-08-25T12:00:00.000Z',
  sl: 0,
  tp: 0,
  swap: 0,
  commission: 0,
  unrealizedPnL: 0,
  ...overrides,
});

describe('useAppStore setPositions burst merge', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.getState().reset();
  });

  it('preserves immediate chart metadata across full and partial server updates', () => {
    useAppStore.getState().setPositions([position(1, {
      chartEntryPrice: 80_001.25,
      chartEntryTime: '2026-08-25T12:00:01.000Z',
    })]);

    useAppStore.getState().setPositions([position(1, {
      openPrice: 80_002,
      currentPrice: 80_003,
    })]);
    expect(useAppStore.getState().positions[0]).toMatchObject({
      openPrice: 80_002,
      currentPrice: 80_003,
      chartEntryPrice: 80_001.25,
      chartEntryTime: '2026-08-25T12:00:01.000Z',
    });

    useAppStore.getState().setPositions([{
      id: 1,
      currentPrice: 80_004,
      unrealizedPnL: 2.5,
    } as Position]);
    expect(useAppStore.getState().positions[0]).toMatchObject({
      id: 1,
      symbol: 'BTCUSD',
      openPrice: 80_002,
      currentPrice: 80_004,
      unrealizedPnL: 2.5,
      chartEntryPrice: 80_001.25,
    });
  });

  it('merges a 500-position unordered burst by strict ticket id and removes absent rows', () => {
    const initial = Array.from({ length: 500 }, (_, index) => position(index + 1));
    useAppStore.getState().setPositions(initial);

    const incoming = initial
      .filter(({ id }) => id % 2 === 0)
      .reverse()
      .map((row) => ({ ...row, currentPrice: row.currentPrice + 10 }));
    useAppStore.getState().setPositions(incoming);

    const result = useAppStore.getState().positions;
    expect(result).toHaveLength(250);
    expect(result.map(({ id }) => id)).toEqual(incoming.map(({ id }) => id));
    expect(result.every((row) => row.id % 2 === 0 && row.currentPrice === 80_011 + row.id)).toBe(true);
  });
});
