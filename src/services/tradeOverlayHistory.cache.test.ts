import { describe, expect, it, vi } from 'vitest';
import { createClosedTradeHistorySnapshotCache, createTradeOverlayCandleLookup, type TradeOverlayHistoryRow } from './tradeOverlayHistory';

describe('validated trade overlay candle index reuse', () => {
  it('reuses sorted time storage but returns replacement historical and forming candle objects', () => {
    const rows = [{ time: 100, high: 10 }, { time: 200, high: 20 }];
    const first = createTradeOverlayCandleLookup(rows, { time: 300, high: 30 });
    const revision = first.mappingRevision();
    rows[0] = { time: 100, high: 90 };
    const current = { time: 300, high: 99 };
    const next = createTradeOverlayCandleLookup(rows, current);
    expect(next.mappingRevision()).toBe(revision);
    expect(next(100)).toBe(rows[0]); expect(next(300)).toBe(current);
  });
  it('checks every interior timestamp even when length, endpoints and array identity match', () => {
    const rows = [{ time: 100 }, { time: 200 }, { time: 300 }];
    const revision = createTradeOverlayCandleLookup(rows).mappingRevision();
    rows[1].time = 220;
    const next = createTradeOverlayCandleLookup(rows);
    expect(next.mappingRevision()).not.toBe(revision);
    expect(next(200, 0)).toBeNull(); expect(next(220, 0)).toBe(rows[1]);
  });
  it('invalidates on timestamp type, duplicate order, history replacement, and sparse deletion', () => {
    const rows: Array<{time: unknown; id: string}> = [{ time: 100, id: 'a' }, { time: 100, id: 'b' }, { time: 300, id: 'c' }];
    const first = createTradeOverlayCandleLookup(rows); const revision = first.mappingRevision();
    rows.reverse(); const reversed = createTradeOverlayCandleLookup(rows);
    expect(reversed.mappingRevision()).not.toBe(revision); expect(reversed(100)?.id).toBe('b');
    rows[0].time = '300'; const typed = createTradeOverlayCandleLookup(rows);
    expect(typed.mappingRevision()).not.toBe(reversed.mappingRevision()); expect(typed(300, 0)).toBeNull();
    delete rows[1]; const sparse = createTradeOverlayCandleLookup(rows);
    expect(sparse.mappingRevision()).not.toBe(typed.mappingRevision()); expect(sparse(100)?.id).toBe('a');
    expect(createTradeOverlayCandleLookup([...rows]).mappingRevision()).not.toBe(sparse.mappingRevision());
  });
  it('validates once per pass without sorting or remapping identical timestamps again', () => {
    let reads = 0;
    const rows = Array.from({ length: 10000 }, (_, i) => ({ get time() { reads++; return 1000 + i * 60; } }));
    const revision = createTradeOverlayCandleLookup(rows).mappingRevision();
    for (let pass = 0; pass < 25; pass++) {
      const lookup = createTradeOverlayCandleLookup(rows);
      expect(lookup.mappingRevision()).toBe(revision);
      for (let i = 0; i < 50; i++) expect(lookup(1000 + i * 60)).toBe(rows[i]);
    }
    expect(reads).toBe(26 * rows.length);
  });
});

const closed = (id: number, patch: TradeOverlayHistoryRow = {}): TradeOverlayHistoryRow => ({ id, symbol: 'BTCUSD',
  historySource: 'closed-position', side: 'BUY', volume: 0.01, openPrice: 100, closePrice: 102,
  openTime: 1000, closeTime: 1060, profit: 2, ...patch });

describe('closed history model reuse during position bursts', () => {
  it('maps unchanged history once across 50 position/PnL passes and applies current open exclusions every pass', () => {
    const read = createClosedTradeHistorySnapshotCache(), rows = Array.from({ length: 100 }, (_, i) => closed(i + 1));
    const revision = {}, mapTimestamp = vi.fn(Number);
    for (let pass = 0; pass < 50; pass++) {
      const result = read({ rows, symbol: 'BTCUSD', mapTimestamp, activeTradeKeys: new Set([`trade:${pass + 1}`]) }, revision, 'M1');
      expect(result).toHaveLength(99); expect(result.some(row => row.key === `trade:${pass + 1}`)).toBe(false);
    }
    expect(mapTimestamp).toHaveBeenCalledTimes(200);
    expect(read({ rows, symbol: 'BTCUSD', mapTimestamp, activeTradeKeys: new Set() }, revision, 'M1')).toHaveLength(100);
    expect(mapTimestamp).toHaveBeenCalledTimes(200);
  });
  it('remaps corrected history, candle hydration, forming-bar boundaries, and active timeframe changes', () => {
    const read = createClosedTradeHistorySnapshotCache(), rows = [closed(1)], candles = [{ time: 1000 }, { time: 1060 }];
    let lookup = createTradeOverlayCandleLookup(candles), offset = 0;
    const mapTimestamp = vi.fn((value: unknown) => Number(value) + offset);
    const options = { rows, symbol: 'BTCUSD', mapTimestamp };
    expect(read(options, lookup.mappingRevision(), 'M1')[0].entryTime).toBe(1000);
    offset = 60; candles[0].time = 990; lookup = createTradeOverlayCandleLookup(candles);
    expect(read(options, lookup.mappingRevision(), 'M1')[0].entryTime).toBe(1060);
    offset = 120; const forming = createTradeOverlayCandleLookup(candles, { time: 1120 });
    expect(read(options, forming.mappingRevision(), 'M1')[0].entryTime).toBe(1120);
    offset = 180; expect(read(options, forming.mappingRevision(), 'M5')[0].entryTime).toBe(1180);
    const corrected = read({ ...options, rows: [closed(1, { closePrice: 103, profit: 3 })] }, forming.mappingRevision(), 'M5');
    expect(corrected[0]).toMatchObject({ exitPrice: 103, profit: 3 });
    expect(mapTimestamp).toHaveBeenCalledTimes(10);
  });
  it('keeps chart/account runtime caches separate and handles history removals and exact symbols', () => {
    const first = createClosedTradeHistorySnapshotCache(), nextAccount = createClosedTradeHistorySnapshotCache();
    const rows = [closed(1)], mapping = {}, mapTimestamp = vi.fn(Number);
    const options = { rows, symbol: 'BTCUSD', mapTimestamp };
    expect(first(options, mapping)).toHaveLength(1); expect(nextAccount(options, mapping)).toHaveLength(1);
    expect(mapTimestamp).toHaveBeenCalledTimes(4);
    expect(first({ ...options, rows: [] }, mapping)).toEqual([]);
    expect(first({ ...options, symbol: 'BTCUSD.r' }, mapping)).toEqual([]);
  });
});
