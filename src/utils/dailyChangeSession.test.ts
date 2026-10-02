import { describe, expect, it } from 'vitest';
import { calculateDailyChange, formatDailyChange, readDailyChangeInput, readTradingViewDailyChangeInput, toTradingViewDailyChangeValues, type DailyChangeInput } from './dailyChange';
import { advanceDailyChange } from './dailyChangeSession';

const start = Date.parse('2026-03-07T22:00:00Z');
const input: DailyChangeInput = { mode: 'bid', provider: 'broker-feed', sessionId: '2026-03-09', sessionStart: start, sessionEnd: Date.parse('2026-03-09T21:00:00Z'), bid: 105, previousClose: 100 };

describe('daily movement arithmetic and display', () => {
  it.each([
    [2025, 2000, 25, 1.25], [97.5, 100, -2.5, -2.5], [100, 100, 0, 0], [105, 100, 5, 5],
  ])('calculates price %s against reference %s at full precision', (price, reference, change, percent) => {
    expect(calculateDailyChange(price, reference)).toEqual({ change, percent });
  });
  it('shows a price difference for zero references and requires a convention for negative references', () => {
    expect(calculateDailyChange(5, 0)).toEqual({ change: 5, percent: undefined });
    expect(calculateDailyChange(-5, -10)).toEqual({ change: 5, percent: undefined });
    expect(calculateDailyChange(-5, -10, 'signed').percent).toBe(-50);
    expect(calculateDailyChange(-5, -10, 'absolute').percent).toBe(50);
    expect(calculateDailyChange(100, undefined)).toEqual({});
    expect(calculateDailyChange(Infinity, 100)).toEqual({});
  });
  it('keeps precision until formatting, uses explicit signs and normalizes rounded negative zero', () => {
    expect(calculateDailyChange(1.000002, 1).change).toBeCloseTo(0.000002, 12);
    expect(formatDailyChange(25)).toBe('+25.00');
    expect(formatDailyChange(-2.5, 2, true)).toBe('-2.50%');
    expect(formatDailyChange(-0.000001, 2, true)).toBe('0.00%');
    expect(formatDailyChange(NaN)).toBe('—');
    expect(formatDailyChange(null)).toBe('—');
  });
  it('keeps TradingView lp and extended-session fields distinct', () => {
    const snapshot = advanceDailyChange(undefined, readTradingViewDailyChangeInput({ lp: 105, bid: 99, prev_close_price: 100, ch: 5, chp: 5, rtc: 108, rch: 8, rchp: 8 }), start)!;
    expect(snapshot).toMatchObject({ price: 105, change: 5, percent: 5, mode: 'last' });
    expect(toTradingViewDailyChangeValues(snapshot, snapshot.price, snapshot.reference?.price)).toEqual({ ch: 5, chp: 5, lp: 105, prev_close_price: 100 });
  });
});

describe('provider-owned daily sessions', () => {
  it('uses Last only in Last mode and honors nonzero futures settlement before close', () => {
    const last = advanceDailyChange(undefined, { ...input, mode: 'last', last: 120, settlement: 80 }, start)!;
    expect(last).toMatchObject({ change: 40, percent: 50, price: 120 });
    expect(advanceDailyChange(undefined, { ...input, mode: 'last', last: undefined }, start)?.percent).toBeUndefined();
    expect(advanceDailyChange(undefined, { ...input, settlement: 0 }, start)?.percent).toBe(5);
  });
  it('reuses an authoritative reference over midnight, weekends and DST within its supplied session', () => {
    const first = advanceDailyChange(undefined, input, start)!;
    const later = advanceDailyChange(first, { bid: 110 }, Date.parse('2026-03-09T20:00:00Z'))!;
    expect(later).toMatchObject({ change: 10, percent: 10 });
    expect(later.reference).toBe(first.reference);
  });
  it('uses the previous eligible session across a holiday without calendar-day assumptions', () => {
    const afterHoliday = advanceDailyChange(undefined, { ...input, sessionId: 'first-session-after-holiday', previousClose: 2000, bid: 2025 }, start)!;
    expect(afterHoliday).toMatchObject({ change: 25, percent: 1.25 });
  });
  it('clears old references at rollover and preserves the opening gap after the new snapshot arrives', () => {
    const first = advanceDailyChange(undefined, input, start)!;
    const rollover = advanceDailyChange(first, { sessionId: 'next', sessionStart: start + 200_000, sessionEnd: start + 300_000, bid: 110 }, start + 200_000)!;
    expect(rollover.reference).toBeUndefined();
    expect(rollover.percent).toBeUndefined();
    const seeded = advanceDailyChange(rollover, { previousClose: 105 }, start + 200_001)!;
    expect(seeded.change).toBe(5);
    expect(seeded.percent).toBeCloseTo(5 / 105 * 100);
  });
  it('never compares a reference-only new-session event with the previous session quote', () => {
    const first = advanceDailyChange(undefined, input, start)!;
    const next = advanceDailyChange(first, { sessionId: 'next', previousClose: 105 }, start + 1)!;
    expect(next.price).toBeUndefined();
    expect(next.change).toBeUndefined();
  });
  it('retains final closed values with their original as-of information past session end', () => {
    const first = advanceDailyChange(undefined, { ...input, status: 'live' }, start)!;
    const closed = advanceDailyChange(first, { status: 'closed' }, input.sessionEnd! + 1)!;
    expect(closed).toMatchObject({ change: 5, percent: 5, status: 'closed', valuesAsOf: start });
  });
  it('rejects out-of-order events and accepts authoritative corrections', () => {
    const first = advanceDailyChange(undefined, input, start + 10)!;
    expect(advanceDailyChange(first, { bid: 90, previousClose: 80 }, start)).toBe(first);
    expect(advanceDailyChange(first, { previousClose: 105 }, start + 10)?.change).toBe(0);
  });
  it('rejects a reference for another applicable session', () => {
    expect(advanceDailyChange(undefined, { ...input, referenceSessionId: 'other' }, start)?.issue).toBe('reference-session-mismatch');
  });
  it('keeps settlement precedence through a sparse previous-close correction', () => {
    const first = advanceDailyChange(undefined, { ...input, settlement: 80 }, start)!;
    expect(advanceDailyChange(first, { previousClose: 101, bid: 110 }, start + 1)).toMatchObject({ change: 30, reference: { kind: 'settlement', price: 80 } });
    expect(advanceDailyChange(first, { settlement: 0, previousClose: 100, bid: 110 }, start + 1)?.change).toBe(10);
  });
  it('retains the quote as-of when only connection status changes', () => {
    const first = advanceDailyChange(undefined, input, start)!;
    expect(advanceDailyChange(first, { status: 'delayed' }, start + 1)).toMatchObject({ percent: 5, valuesAsOf: start, status: 'delayed' });
  });
  it('rejects provider, price-basis and adjustment mismatches', () => {
    expect(advanceDailyChange(undefined, { ...input, referenceProvider: 'other' }, start)?.issue).toBe('provider-mismatch');
    expect(advanceDailyChange(undefined, { ...input, referenceMode: 'last' }, start)?.issue).toBe('price-basis-mismatch');
    expect(advanceDailyChange(undefined, { ...input, adjustment: 'raw', referenceAdjustment: 'split' }, start)?.issue).toBe('adjustment-mismatch');
  });
  it('reports missing session metadata and marks retained unscoped values stale without recalculating', () => {
    const first = advanceDailyChange(undefined, { mode: 'bid', bid: 105, previousClose: 100 }, start)!;
    expect(first.issue).toBe('session-unavailable');
    const later = advanceDailyChange(first, { bid: 110 }, start + 1)!;
    expect(later).toMatchObject({ change: 5, percent: 5, status: 'stale', valuesAsOf: start });
    expect(later.reference).toBeUndefined();
  });
  it('handles disconnect/reconnect snapshots and clears explicit invalidated references', () => {
    const first = advanceDailyChange(undefined, input, start)!;
    const disconnected = advanceDailyChange(first, { status: 'disconnected' }, start + 1)!;
    expect(disconnected.percent).toBe(5);
    const restored = advanceDailyChange(disconnected, { ...input, bid: 115, status: 'live' }, start + 2)!;
    expect(restored.percent).toBe(15);
    expect(advanceDailyChange(restored, { previousClose: null }, start + 3)?.percent).toBeUndefined();
  });
  it('ignores chart timeframe and display timezone fields and rejects local date parsing', () => {
    const raw = { bid: 105, previous_close: 100, chart_mode: 'bid', session_id: 'session', session_start: '2026-03-07T22:00:00Z' };
    const before = advanceDailyChange(undefined, readDailyChangeInput(raw), start);
    const after = advanceDailyChange(undefined, readDailyChangeInput({ ...raw, chart_timeframe: 'W1', timezone: 'Asia/Calcutta' }), start);
    expect(after).toEqual(before);
    expect(readDailyChangeInput({ session_start: '2026-03-07T22:00:00' }).sessionStart).toBeUndefined();
  });
});
