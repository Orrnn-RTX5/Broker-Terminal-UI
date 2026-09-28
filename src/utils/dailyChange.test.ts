import { describe, expect, it } from 'vitest';

import {
  composeDailyChangeQuoteContext,
  readDailyChangeLastPrice,
  readDailyChangePercent,
  readDailyChangePreviousClose,
  readDailyChangePriceMode,
  resolveDailyChangePercent,
} from './dailyChange';

describe('resolveDailyChangePercent', () => {
  it('composes child and envelope metadata independently by semantic alias group', () => {
    const context = composeDailyChangeQuoteContext({
      dailyChange: 0.25,
      previousClose: 90,
    }, {
      daily_change_pct: 0.75,
      last_price: 120,
      settlement_price: 80,
      previous_close: 100,
      chart_mode: 1,
    });

    expect(readDailyChangePercent(context)).toBe(0.25);
    expect(readDailyChangeLastPrice(context)).toBe(120);
    expect(readDailyChangePreviousClose(context)).toBe(90);
    expect(readDailyChangePriceMode(context)).toBe('last');
    expect(resolveDailyChangePercent(undefined, 110, readDailyChangePreviousClose(context), context)).toBe(50);
  });

  it('lets explicit invalid child groups block otherwise valid envelope metadata', () => {
    const context = composeDailyChangeQuoteContext({
      dailyChangePct: 'unknown',
      last: 0,
      settlementPrice: null,
      previousClose: 'unknown',
      chartMode: 'future-mode',
    }, {
      daily_change_pct: 0.75,
      last_price: 120,
      settlement_price: 80,
      previous_close: 100,
      chart_mode: 1,
    });

    expect(readDailyChangePercent(context)).toBeUndefined();
    expect(readDailyChangeLastPrice(context)).toBeUndefined();
    expect(readDailyChangePreviousClose(context)).toBeUndefined();
    expect(readDailyChangePriceMode(context)).toBeUndefined();
    expect(resolveDailyChangePercent(undefined, 110, readDailyChangePreviousClose(context), context)).toBeUndefined();
  });

  it('uses the nearest owning wrapper independently for every group across nested envelopes', () => {
    const context = composeDailyChangeQuoteContext({
      previousClose: 90,
    }, {
      dailyChangePct: 'unknown',
      last_price: 120,
      settlement_price: 80,
      chart_mode: 1,
    }, [{
      daily_change_pct: 0.75,
      last: 130,
      settlementPrice: 70,
      previous_close: 100,
      chartMode: 0,
    }]);

    // The child close wins, the nearest wrapper supplies Last/baseline/mode,
    // and its explicit invalid percentage blocks the outer percentage.
    expect(readDailyChangePercent(context)).toBeUndefined();
    expect(readDailyChangeLastPrice(context)).toBe(120);
    expect(readDailyChangePreviousClose(context)).toBe(90);
    expect(readDailyChangePriceMode(context)).toBe('last');
    expect(resolveDailyChangePercent(undefined, 110, 90, context)).toBe(50);
  });

  it('reads the broker percentage field and its supported aliases', () => {
    expect(readDailyChangePercent({ daily_change_pct: 0.45 })).toBe(0.45);
    expect(readDailyChangePercent({ dailyChangePct: -0.12 })).toBe(-0.12);
    expect(readDailyChangePercent({ daily_change: 0.19 })).toBe(0.19);
    expect(readDailyChangePercent({ dailyChange: -0.36 })).toBe(-0.36);
    expect(readDailyChangePercent({ daily_change_pct: '', daily_change: 0.07 })).toBe(0.07);
  });

  it('skips unusable percentage aliases and returns the first finite value', () => {
    expect(readDailyChangePercent({
      dailyChangePct: 'not-a-number',
      daily_change_pct: Number.POSITIVE_INFINITY,
      dailyChange: ' 0.27 ',
      daily_change: 0.99,
    })).toBe(0.27);
    expect(readDailyChangePercent({ dailyChangePct: ' ', daily_change_pct: Number.NaN })).toBeUndefined();
  });

  it('uses an upstream percentage without recalculating it', () => {
    expect(resolveDailyChangePercent('0.19', 110, 100)).toBe(0.19);
    expect(resolveDailyChangePercent(0, 110, 100)).toBe(0);
  });

  it('calculates a Bid-based percentage from the previous session close', () => {
    expect(resolveDailyChangePercent(undefined, 110, '100')).toBeCloseTo(10, 10);
  });

  it('uses Last for numeric and string Last chart modes', () => {
    expect(resolveDailyChangePercent(undefined, 110, 100, {
      chart_mode: 1,
      last: 120,
    })).toBeCloseTo(20, 10);
    expect(resolveDailyChangePercent(undefined, 110, 100, {
      chartMode: 'SYMBOL_CHART_MODE_LAST',
      last_price: '125',
    })).toBeCloseTo(25, 10);
  });

  it('uses a registered Last mode only when raw mode metadata is absent', () => {
    expect(resolveDailyChangePercent(undefined, 0, 100, {
      last: 120,
    }, 'last')).toBeCloseTo(20, 10);
    expect(resolveDailyChangePercent(undefined, 110, 100, {
      chart_mode: 'future-mode',
      last: 120,
    }, undefined)).toBeCloseTo(10, 10);
  });

  it('exposes only explicit chart mode and positive Last metadata to transports', () => {
    expect(readDailyChangePriceMode({ chart_mode: 1 })).toBe('last');
    expect(readDailyChangePriceMode({ chartMode: 'by bid price' })).toBe('bid');
    expect(readDailyChangePriceMode({ last: 120 })).toBeUndefined();
    expect(readDailyChangePriceMode({ chart_mode: 'future-mode' })).toBeUndefined();
    expect(readDailyChangeLastPrice({ last: 0, last_price: '120' })).toBe(120);
    expect(readDailyChangeLastPrice({ last: -1, lastPrice: ' ' })).toBeUndefined();
  });

  it('defaults unknown chart modes to Bid and never substitutes Bid for a missing Last', () => {
    expect(resolveDailyChangePercent(undefined, 110, 100, {
      chart_mode: 'future-mode',
      last: 120,
    })).toBeCloseTo(10, 10);
    expect(resolveDailyChangePercent(undefined, 110, 100, {
      chart_mode: 'last',
    })).toBeUndefined();
    expect(resolveDailyChangePercent(undefined, 110, 100, {
      chart_mode: 1,
      last: 0,
    })).toBeUndefined();
  });

  it('prefers a nonzero settlement or clearing baseline over previous close', () => {
    expect(resolveDailyChangePercent(undefined, 110, 100, {
      settlement_price: 80,
    })).toBeCloseTo(37.5, 10);
    expect(resolveDailyChangePercent(undefined, 110, 100, {
      settlement_price: -1,
      clearingPrice: 88,
    })).toBeCloseTo(25, 10);
  });

  it('does not invent a percentage when the previous session close is unavailable', () => {
    expect(resolveDailyChangePercent(undefined, 110, undefined)).toBeUndefined();
    expect(resolveDailyChangePercent(undefined, 110, 0)).toBeUndefined();
  });
});
