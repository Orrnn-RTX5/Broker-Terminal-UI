import { describe, expect, it } from 'vitest';
import {
  buildOptimisticClosedTradeSnapshot,
  buildClosedTradeHistorySnapshots,
  filterActiveTradeKeysForHistory,
  getTradeOverlayCloseState,
  getTradeOverlayCloseTicketKeys,
  getTradeOverlayRedrawDecision,
  resolveNearestTradeOverlayCandleTime,
  resolveStableTradeEntryTime,
  shouldKeepMissingActiveTradeOverlay,
  type TradeOverlayHistoryRow,
} from './tradeOverlayHistory';

const mapTimestamp = (value: unknown): number => {
  if (value == null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && String(value).trim() !== '') {
    return numeric > 1_000_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
};

const build = (
  rows: TradeOverlayHistoryRow[],
  activeTradeKeys?: ReadonlySet<string>,
) => buildClosedTradeHistorySnapshots({
  rows,
  symbol: 'GBPUSD',
  mapTimestamp,
  activeTradeKeys,
});

describe('buildClosedTradeHistorySnapshots', () => {
  it('does not create a closed connector from an entry-in-only deal', () => {
    expect(build([
      {
        historySource: 'deal',
        positionId: 270,
        dealTicket: 1001,
        symbol: 'GBPUSD',
        type: 'entry_in',
        entry: 'entry_in',
        side: 'BUY',
        volume: 0.01,
        price: 1.34149,
        time: 1760000000,
      },
    ])).toEqual([]);
  });

  it('ignores order rows, including closed-order-shaped rows', () => {
    expect(build([
      {
        historySource: 'order',
        id: 4001,
        symbol: 'GBPUSD',
        type: 'closed',
        status: 'closed',
        side: 'BUY',
        volume: 0.01,
        openPrice: 1.34149,
        closePrice: 1.34324,
        openTime: 1760000000,
        closeTime: 1760000300,
      },
    ])).toEqual([]);
  });

  it('creates one snapshot from a complete MT5 entry-in and entry-out deal pair', () => {
    expect(build([
      {
        historySource: 'deal',
        positionId: 270,
        dealTicket: 1001,
        symbol: 'GBPUSD',
        type: 'entry_in',
        entry: 'entry_in',
        side: 'BUY',
        volume: 0.01,
        price: 1.34149,
        time: 1760000000,
      },
      {
        historySource: 'deal',
        positionId: 270,
        dealTicket: 1002,
        symbol: 'GBPUSD',
        type: 'entry_out',
        entry: 'entry_out',
        side: 'SELL',
        volume: 0.01,
        price: 1.34324,
        profit: 1.75,
        time: 1760000300,
      },
    ])).toEqual([
      expect.objectContaining({
        key: 'trade:270',
        symbol: 'GBPUSD',
        side: 'BUY',
        volume: 0.01,
        entryPrice: 1.34149,
        entryTime: 1760000000,
        exitPrice: 1.34324,
        exitTime: 1760000300,
        profit: 1.75,
        source: 'mt5-history',
      }),
    ]);
  });

  it('creates one snapshot from an untagged MT5 enum entry deal pair', () => {
    expect(build([
      {
        positionId: 270,
        dealTicket: 1001,
        symbol: 'GBPUSD',
        type: 0,
        entry: 0,
        side: 0,
        volume: 0.01,
        price: 1.34149,
        time_ms: 1760000000000,
      },
      {
        positionId: 270,
        dealTicket: 1002,
        symbol: 'GBPUSD',
        type: 1,
        entry: 1,
        side: 1,
        volume: 0.01,
        price: 1.34324,
        profit: 1.75,
        time_ms: 1760000300000,
      },
    ])).toEqual([
      expect.objectContaining({
        key: 'trade:270',
        symbol: 'GBPUSD',
        side: 'BUY',
        volume: 0.01,
        entryPrice: 1.34149,
        entryTime: 1760000000,
        exitPrice: 1.34324,
        exitTime: 1760000300,
        profit: 1.75,
        source: 'mt5-history',
      }),
    ]);
  });

  it('creates one snapshot from a confirmed closed-position row', () => {
    expect(build([
      {
        historySource: 'closed-position',
        id: 271,
        symbol: 'GBPUSD',
        type: 'closed_position',
        status: 'closed',
        side: 'SELL',
        volume: 0.01,
        openPrice: 1.34352,
        closePrice: 1.34208,
        openTime: '2026-06-16T19:04:31.000Z',
        closeTime: '2026-06-16T19:09:31.000Z',
        profit: -1.44,
      },
    ])).toEqual([
      expect.objectContaining({
        key: 'trade:271',
        symbol: 'GBPUSD',
        side: 'SELL',
        entryPrice: 1.34352,
        exitPrice: 1.34208,
        source: 'app-history',
      }),
    ]);
  });

  it('does not create a connector for a ticket that is still active on the chart', () => {
    expect(build([
      {
        historySource: 'closed-position',
        id: 270,
        symbol: 'GBPUSD',
        type: 'closed_position',
        status: 'closed',
        side: 'BUY',
        volume: 0.01,
        openPrice: 1.34149,
        closePrice: 1.34324,
        openTime: 1760000000,
        closeTime: 1760000300,
        profit: 1.75,
      },
    ], new Set(['trade:270']))).toEqual([]);
  });

  it('allows a confirmed closed connector when the same ticket is close-suppressed', () => {
    const activeTradeKeys = filterActiveTradeKeysForHistory(
      new Set(['trade:270']),
      new Set(['trade:270']),
    );

    expect(build([
      {
        historySource: 'closed-position',
        id: 270,
        symbol: 'GBPUSD',
        type: 'closed_position',
        status: 'closed',
        side: 'BUY',
        volume: 0.01,
        openPrice: 1.34149,
        closePrice: 1.34324,
        openTime: 1760000000,
        closeTime: 1760000300,
        profit: 1.75,
      },
    ], activeTradeKeys)).toEqual([
      expect.objectContaining({
        key: 'trade:270',
        source: 'app-history',
      }),
    ]);
  });
});

describe('trade overlay close suppression helpers', () => {
  it('uses the current forming candle for a trade opened on a just-created candle', () => {
    expect(resolveNearestTradeOverlayCandleTime(
      1760000340,
      [{ time: 1760000280 }],
      { time: 1760000340 },
    )).toBe(1760000340);
  });

  it('falls back to historical candles when there is no current forming candle', () => {
    expect(resolveNearestTradeOverlayCandleTime(
      1760000340,
      [{ time: 1760000280 }, { time: 1760000400 }],
      null,
    )).toBe(1760000400);
  });

  it('does not snap an old refreshed trade to the current candle outside the allowed distance', () => {
    expect(resolveNearestTradeOverlayCandleTime(
      1760000340,
      [{ time: 1760000580 }],
      { time: 1760000640 },
      30,
    )).toBeNull();
  });

  it('allows near-candle snapping inside the allowed distance', () => {
    expect(resolveNearestTradeOverlayCandleTime(
      1760000340,
      [{ time: 1760000310 }],
      null,
      30,
    )).toBe(1760000310);
  });

  it('keeps an already resolved trade entry time stable across later candle redraws', () => {
    expect(resolveStableTradeEntryTime(
      1760000340,
      1760000399,
      () => 1760000400,
      1760000400,
    )).toBe(1760000340);
  });

  it('resolves and returns the mapped candle time when no entry time is stored yet', () => {
    expect(resolveStableTradeEntryTime(
      null,
      1760000399,
      () => 1760000340,
      1760000400,
    )).toBe(1760000340);
  });

  it('extracts unique active trade keys from close event detail', () => {
    expect(getTradeOverlayCloseTicketKeys({
      ticketIds: [270, '270', 0],
      ticket: '313',
      id: '',
    })).toEqual(['trade:270', 'trade:313']);
  });

  it('parses close event state and ignores unknown statuses', () => {
    expect(getTradeOverlayCloseState({ status: 'failed' })).toBe('failed');
    expect(getTradeOverlayCloseState({ status: 'unknown' })).toBeNull();
  });

  it('keeps missing active trades only when they are not closed or close-suppressed', () => {
    expect(shouldKeepMissingActiveTradeOverlay({
      tradeKey: 'trade:270',
      closeSuppressedTradeKeys: new Set(['trade:270']),
      closedHistoryTradeKeys: new Set(),
    })).toBe(false);

    expect(shouldKeepMissingActiveTradeOverlay({
      tradeKey: 'trade:270',
      closeSuppressedTradeKeys: new Set(),
      closedHistoryTradeKeys: new Set(),
    })).toBe(true);
  });

  it('builds an immediate closed connector from a captured active trade and close point', () => {
    expect(buildOptimisticClosedTradeSnapshot({
      key: 'trade:270',
      symbol: 'gbp/usd',
      side: 'BUY',
      volume: 0.01,
      entryPrice: 1.34149,
      entryTime: 1760000000,
      exitPrice: 1.34324,
      exitTime: 1760000300,
    })).toEqual(expect.objectContaining({
      key: 'trade:270',
      symbol: 'GBPUSD',
      side: 'BUY',
      entryPrice: 1.34149,
      entryTime: 1760000000,
      exitPrice: 1.34324,
      exitTime: 1760000300,
      source: 'app-history',
    }));
  });

  it('does not build an immediate closed connector without a close point', () => {
    expect(buildOptimisticClosedTradeSnapshot({
      key: 'trade:270',
      symbol: 'GBPUSD',
      side: 'BUY',
      volume: 0.01,
      entryPrice: 1.34149,
      entryTime: 1760000000,
      exitPrice: 0,
      exitTime: 1760000300,
    })).toBeNull();
  });
});

describe('getTradeOverlayRedrawDecision', () => {
  it('redraws only the active layer when the active signature changes', () => {
    expect(getTradeOverlayRedrawDecision({
      lastActiveSignature: 'active:a',
      nextActiveSignature: 'active:b',
      lastHistorySignature: 'history:a',
      nextHistorySignature: 'history:a',
    })).toEqual({
      activeChanged: true,
      historyChanged: false,
    });
  });

  it('preserves both layers when signatures are unchanged', () => {
    expect(getTradeOverlayRedrawDecision({
      lastActiveSignature: 'active:a',
      nextActiveSignature: 'active:a',
      lastHistorySignature: 'history:a',
      nextHistorySignature: 'history:a',
    })).toEqual({
      activeChanged: false,
      historyChanged: false,
    });
  });

  it('does not redraw history when the missing-position timer forces active only', () => {
    expect(getTradeOverlayRedrawDecision({
      lastActiveSignature: 'active:a',
      nextActiveSignature: 'active:a',
      lastHistorySignature: 'history:a',
      nextHistorySignature: 'history:a',
      forceActive: true,
    })).toEqual({
      activeChanged: true,
      historyChanged: false,
    });
  });
});
