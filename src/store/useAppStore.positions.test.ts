// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import { shouldReplaceOpenPositionSnapshot, type Position, useAppStore } from './useAppStore';

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

  it('rejects unknown sparse rows while preserving a known ticket update', () => {
    useAppStore.getState().setPositions([position(24_155, {
      symbol: 'BTCUSD',
      volume: 0.01,
      openPrice: 79_500,
    })]);

    useAppStore.getState().setPositions([
      {
        id: 24_155,
        currentPrice: 79_608.32,
        unrealizedPnL: -1.65,
      } as Position,
      {
        id: 1,
        symbol: '',
        side: 'BUY',
        volume: 0,
        currentPrice: 0,
      } as Position,
      {
        id: 24_185,
        symbol: '',
        side: 'BUY',
        volume: 0,
        currentPrice: 79_608.32,
        unrealizedPnL: -0.22,
      } as Position,
    ]);

    expect(useAppStore.getState().positions).toEqual([
      expect.objectContaining({
        id: 24_155,
        symbol: 'BTCUSD',
        volume: 0.01,
        openPrice: 79_500,
        currentPrice: 79_608.32,
        unrealizedPnL: -1.65,
      }),
    ]);
  });

  it('admits a complete new ticket even when opening price is not in the snapshot', () => {
    useAppStore.getState().setPositions([position(24_185, {
      symbol: 'BTCUSD',
      volume: 0.01,
      openPrice: 0,
      currentPrice: 79_608.32,
    })]);

    expect(useAppStore.getState().positions).toEqual([
      expect.objectContaining({ id: 24_185, symbol: 'BTCUSD', volume: 0.01 }),
    ]);
  });

  it('keeps a just-filled ticket when a lagged snapshot omits it', () => {
    useAppStore.getState().setPositions([
      position(101),
      position(102, {
        chartEntryPrice: 80_110,
        chartEntryTime: new Date().toISOString(),
      }),
    ]);

    useAppStore.getState().setPositions([position(101, { currentPrice: 80_050 })]);

    expect(useAppStore.getState().positions.map(({ id }) => id).sort((a, b) => a - b)).toEqual([101, 102]);
    expect(useAppStore.getState().positions.find(({ id }) => id === 102)).toMatchObject({
      id: 102,
      symbol: 'BTCUSD',
      volume: 0.01,
      chartEntryTime: expect.any(String),
    });
  });

  it('does not apply an empty snapshot over a just-filled ticket', () => {
    const recent = position(102, { chartEntryTime: new Date().toISOString() });
    expect(shouldReplaceOpenPositionSnapshot([], [recent])).toBe(false);
    expect(shouldReplaceOpenPositionSnapshot([], [position(101)])).toBe(true);
    expect(shouldReplaceOpenPositionSnapshot([position(101)], [recent])).toBe(true);
  });

  it('still drops an older ticket that a full snapshot no longer reports', () => {
    useAppStore.getState().setPositions([
      position(101, { chartEntryTime: '2026-08-25T12:00:01.000Z' }),
      position(102),
    ]);

    useAppStore.getState().setPositions([position(102)]);

    expect(useAppStore.getState().positions).toEqual([
      expect.objectContaining({ id: 102 }),
    ]);
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
