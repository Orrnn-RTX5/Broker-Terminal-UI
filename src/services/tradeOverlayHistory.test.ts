import { describe, expect, it } from 'vitest';
import {
  buildOptimisticClosedTradeSnapshot,
  buildClosedTradeHistorySnapshots,
  clearTradeOverlayOptimisticClosedSnapshots,
  filterActiveTradeKeysForHistory,
  getTradeOverlayOptimisticClosedSnapshots,
  getTradeOverlayCloseSnapshots,
  getTradeOverlayCloseState,
  getTradeOverlayCloseTicketKeys,
  getTradeOverlayRedrawDecision,
  rememberTradeOverlayOptimisticClosedSnapshots,
  resolveNearestTradeOverlayCandleTime,
  resolveStableTradeEntryPrice,
  resolveStableTradeEntryTime,
  resolveTradeOverlaySegmentGeometry,
  shouldKeepMissingActiveTradeOverlay,
  shouldUseClosedTradeHistorySnapshot,
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

  it('keeps an already resolved trade entry price stable across current-price updates', () => {
    expect(resolveStableTradeEntryPrice(
      1.34149,
      1.34210,
      1.34210,
    )).toBe(1.34149);
  });

  it('uses a live fallback entry price only until a price has been frozen', () => {
    expect(resolveStableTradeEntryPrice(
      null,
      0,
      1.34210,
    )).toBe(1.34210);
  });

  it('extracts unique active trade keys from close event detail', () => {
    expect(getTradeOverlayCloseTicketKeys({
      ticketIds: [270, '270', 0],
      ticket: '313',
      id: '',
    })).toEqual(['trade:270', 'trade:313']);
  });

  it('extracts normalized close snapshots from close event detail', () => {
    expect(getTradeOverlayCloseSnapshots({
      snapshots: [
        {
          ticketId: 270,
          symbol: 'gbp/usd',
          side: 'BUY',
          volume: '0.01',
          entryPrice: '1.34149',
          entryTime: 1760000000000,
          exitPrice: '1.34324',
          closeTime: 1760000300000,
        },
      ],
    })).toEqual([
      expect.objectContaining({
        key: 'trade:270',
        symbol: 'GBPUSD',
        side: 'BUY',
        volume: 0.01,
        entryPrice: 1.34149,
        entryTime: 1760000000,
        exitPrice: 1.34324,
        exitTime: 1760000300,
      }),
    ]);
  });

  it('parses MT5-style close snapshot timestamps', () => {
    expect(getTradeOverlayCloseSnapshots({
      snapshots: [
        {
          ticketId: 271,
          symbol: 'GBPUSD',
          side: 'SELL',
          volume: '0.01',
          entryPrice: '1.34149',
          entryTime: '2026.06.22 14:35:34',
          exitPrice: '1.34020',
          closeTime: '2026.06.22 14:40:07',
        },
      ],
    })).toEqual([
      expect.objectContaining({
        key: 'trade:271',
        side: 'SELL',
        entryTime: Math.floor(Date.UTC(2026, 5, 22, 14, 35, 34) / 1000),
        exitTime: Math.floor(Date.UTC(2026, 5, 22, 14, 40, 7) / 1000),
      }),
    ]);
  });

  it('ignores incomplete close snapshots without an entry-to-exit path', () => {
    expect(getTradeOverlayCloseSnapshots({
      snapshots: [
        {
          ticketId: 270,
          symbol: 'GBPUSD',
          side: 'BUY',
          entryPrice: 1.34149,
          entryTime: 1760000000,
          exitPrice: 0,
          closeTime: 1760000300,
        },
      ],
    })).toEqual([]);
  });

  it('keeps close-all snapshots available for charts mounted after the close event', () => {
    clearTradeOverlayOptimisticClosedSnapshots();

    rememberTradeOverlayOptimisticClosedSnapshots({
      snapshots: [
        {
          ticketId: 270,
          symbol: 'XAUUSD',
          side: 'BUY',
          volume: 0.01,
          entryPrice: 4207.47,
          entryTime: 1760000000,
          exitPrice: 4206.42,
          closeTime: 1760000300,
        },
        {
          ticketId: 271,
          symbol: 'GBPUSD',
          side: 'BUY',
          volume: 0.01,
          entryPrice: 1.32231,
          entryTime: 1760000100,
          exitPrice: 1.32245,
          closeTime: 1760000300,
        },
      ],
    }, 1_760_000_300_000);

    expect(getTradeOverlayOptimisticClosedSnapshots('GBP/USD', 1_760_000_301_000)).toEqual([
      expect.objectContaining({
        key: 'trade:271',
        symbol: 'GBPUSD',
        entryPrice: 1.32231,
        exitPrice: 1.32245,
      }),
    ]);

    clearTradeOverlayOptimisticClosedSnapshots();
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

  it('keeps a complete optimistic connector over point-only backend history', () => {
    const completeOptimistic = buildOptimisticClosedTradeSnapshot({
      key: 'trade:270',
      symbol: 'GBPUSD',
      side: 'BUY',
      volume: 0.01,
      entryPrice: 1.34149,
      entryTime: 1760000000,
      exitPrice: 1.34324,
      exitTime: 1760000300,
    });
    const pointOnlyBackend = buildOptimisticClosedTradeSnapshot({
      key: 'trade:270',
      symbol: 'GBPUSD',
      side: 'BUY',
      volume: 0.01,
      entryPrice: 1.34149,
      entryTime: 1760000000,
      exitPrice: 1.34149,
      exitTime: 1760000000,
    });
    expect(completeOptimistic).not.toBeNull();
    expect(pointOnlyBackend).not.toBeNull();

    const canRenderTradePath = (trade: NonNullable<typeof completeOptimistic>) =>
      Math.abs(trade.entryTime - trade.exitTime) > 0
      || Math.abs(trade.entryPrice - trade.exitPrice) > 0.00001;

    expect(shouldUseClosedTradeHistorySnapshot({
      existingTrade: completeOptimistic ?? undefined,
      candidateTrade: pointOnlyBackend!,
      canRenderTradePath,
    })).toBe(false);
  });

  it('keeps same-candle history connectors visible with a minimum segment length', () => {
    expect(resolveTradeOverlaySegmentGeometry({
      x1: 420,
      y1: 180,
      x2: 420,
      y2: 180,
      minLengthPx: 24,
    })).toEqual({
      left: 420,
      top: 180,
      width: 24,
      angleDeg: 0,
    });
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
