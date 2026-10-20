import { describe, expect, it } from 'vitest';
import {
  buildTradeHistoryBadgeText,
  formatTradeHistoryGmtTime,
  getTradeHistoryLabelMaxWidth,
  getTradeHistoryExecutionSide,
  getTradeHistoryMarkerPrice,
  resolveTradeHistoryLabelPlacement,
  resolveTradeHistoryLabelVerticalPlacement,
} from './chartTradeHistoryPresentation';

describe('chart trade-history presentation', () => {
  it('formats execution time in GMT instead of the machine timezone', () => {
    const timestamp = Date.UTC(2026, 7, 31, 16, 30, 45) / 1000;

    expect(formatTradeHistoryGmtTime(timestamp)).toBe('16:30 GMT');
    expect(formatTradeHistoryGmtTime(timestamp, { includeSeconds: true })).toBe('16:30:45 GMT');
  });

  it('builds explicit open and close labels with one GMT timestamp', () => {
    const time = Date.UTC(2026, 7, 31, 17, 15) / 1000;

    expect(buildTradeHistoryBadgeText({
      positionSide: 'BUY',
      lifecycle: 'OPEN',
      ticketLabel: '#5',
      price: 4599.58,
      digits: 2,
      time,
    })).toBe('BUY OPEN · #5 · 4599.58 · 17:15 GMT');

    expect(buildTradeHistoryBadgeText({
      positionSide: 'SELL',
      lifecycle: 'CLOSE',
      ticketLabel: '#8',
      price: 4601.1,
      digits: 2,
      time,
    })).toBe('SELL CLOSE · #8 · 4601.10 · 17:15 GMT');

    expect(buildTradeHistoryBadgeText({
      positionSide: 'BUY',
      lifecycle: 'CLOSE',
      price: 4601.1,
      digits: 2,
      time: time + 9,
      includeSeconds: true,
    })).toBe('BUY CLOSE · 4601.10 · 17:15:09 GMT');
  });

  it('renders the raw price when the broker published no digits (TERM-DIGITS-WL)', () => {
    const time = Date.UTC(2026, 7, 31, 17, 15) / 1000;
    expect(buildTradeHistoryBadgeText({
      positionSide: 'BUY',
      lifecycle: 'OPEN',
      price: 150.1234,
      digits: null,
      time,
    })).toBe('BUY OPEN · 150.1234 · 17:15 GMT');
    expect(buildTradeHistoryBadgeText({
      positionSide: 'SELL',
      lifecycle: 'OPEN',
      price: 150,
      digits: 0,
      time,
    })).toBe('SELL OPEN · 150 · 17:15 GMT');
  });

  it('keeps the position side in the label while reversing only close execution', () => {
    expect(getTradeHistoryExecutionSide('BUY', 'OPEN')).toBe('BUY');
    expect(getTradeHistoryExecutionSide('BUY', 'CLOSE')).toBe('SELL');
    expect(getTradeHistoryExecutionSide('SELL', 'OPEN')).toBe('SELL');
    expect(getTradeHistoryExecutionSide('SELL', 'CLOSE')).toBe('BUY');
  });

  it('anchors buy and sell executions to the trade price point on the candle and clamps to the candle range', () => {
    const candle = { high: 81300, low: 81200 };
    expect(getTradeHistoryMarkerPrice('BUY', 81250, candle)).toBe(81250);
    expect(getTradeHistoryMarkerPrice('SELL', 81250, candle)).toBe(81250);
    expect(getTradeHistoryMarkerPrice(getTradeHistoryExecutionSide('BUY', 'CLOSE'), 81260, candle)).toBe(81260);
    expect(getTradeHistoryMarkerPrice(getTradeHistoryExecutionSide('SELL', 'CLOSE'), 81260, candle)).toBe(81260);
    expect(getTradeHistoryMarkerPrice('BUY', 81340, candle)).toBe(81300);
    expect(getTradeHistoryMarkerPrice('SELL', 81150, candle)).toBe(81200);
  });

  it('uses the execution price while the candle is unavailable', () => {
    expect(getTradeHistoryMarkerPrice('BUY', 81250, null)).toBe(81250);
    expect(getTradeHistoryMarkerPrice('SELL', 81250, { high: Number.NaN, low: 81200 })).toBe(81250);
    expect(getTradeHistoryMarkerPrice('BUY', 0, { high: 1, low: -1 })).toBe(-1);
  });

  it('flips labels before the price scale and clamps them inside the plot', () => {
    expect(resolveTradeHistoryLabelPlacement({
      anchorX: 80,
      labelWidth: 180,
      plotWidth: 900,
    })).toEqual({ left: 94, anchor: 'right' });

    expect(resolveTradeHistoryLabelPlacement({
      anchorX: 840,
      labelWidth: 180,
      plotWidth: 900,
    })).toEqual({ left: 646, anchor: 'left' });

    expect(resolveTradeHistoryLabelPlacement({
      anchorX: 5,
      labelWidth: 100,
      plotWidth: 120,
    })).toEqual({ left: 6, anchor: 'left' });
  });

  it('shrinks an edge badge before allowing it to cover the arrow', () => {
    const leftEdgeWidth = getTradeHistoryLabelMaxWidth({
      anchorX: 5,
      plotWidth: 120,
    });
    const rightEdgeWidth = getTradeHistoryLabelMaxWidth({
      anchorX: 115,
      plotWidth: 120,
    });

    expect(leftEdgeWidth).toBe(95);
    expect(resolveTradeHistoryLabelPlacement({
      anchorX: 5,
      labelWidth: leftEdgeWidth,
      plotWidth: 120,
    })).toEqual({ left: 19, anchor: 'right' });

    expect(rightEdgeWidth).toBe(95);
    expect(resolveTradeHistoryLabelPlacement({
      anchorX: 115,
      labelWidth: rightEdgeWidth,
      plotWidth: 120,
    })).toEqual({ left: 6, anchor: 'left' });
  });

  it('moves colliding open and close badges into separate vertical lanes', () => {
    const open = resolveTradeHistoryLabelVerticalPlacement({
      preferredCenterY: 100,
      labelHeight: 22,
      chartHeight: 300,
      left: 94,
      width: 190,
      occupied: [],
    });
    const close = resolveTradeHistoryLabelVerticalPlacement({
      preferredCenterY: 100,
      labelHeight: 22,
      chartHeight: 300,
      left: 94,
      width: 190,
      occupied: [open.rect],
    });

    expect(open).toMatchObject({ centerY: 100, lane: 0 });
    expect(close).toMatchObject({ centerY: 74, lane: -1 });
    expect(close.rect.top + close.rect.height).toBeLessThanOrEqual(open.rect.top - 4);
  });

  it('uses the available lane when a collision occurs against the chart edge', () => {
    const first = resolveTradeHistoryLabelVerticalPlacement({
      preferredCenterY: 8,
      labelHeight: 22,
      chartHeight: 100,
      left: 10,
      width: 80,
      occupied: [],
    });
    const second = resolveTradeHistoryLabelVerticalPlacement({
      preferredCenterY: 8,
      labelHeight: 22,
      chartHeight: 100,
      left: 10,
      width: 80,
      occupied: [first.rect],
    });

    expect(first.rect.top).toBe(4);
    expect(second.lane).toBe(1);
    expect(second.rect.top).toBeGreaterThanOrEqual(first.rect.top + first.rect.height + 4);
  });
});
