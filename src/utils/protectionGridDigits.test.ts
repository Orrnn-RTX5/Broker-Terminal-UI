import { describe, expect, it } from 'vitest';

import {
  applyTradeLevelDragUpdate,
  clampTradeLevelToCurrentPrice,
  defaultProtectionLevel,
  normalizeTradeLevelDragPrice,
  protectionLevelViolation,
  readKnownPriceDigits,
  roundProtectionLevelToGrid,
} from './tradeLevelDrag';

describe('roundProtectionLevelToGrid with known broker digits', () => {
  it('rounds to the digit step when no tick size is published', () => {
    expect(roundProtectionLevelToGrid(1.228444, 3)).toBe(1.228);
  });

  it('snaps to the nearest multiple of a published tick size', () => {
    expect(roundProtectionLevelToGrid(1.37, 2, 0.25)).toBe(1.25);
    expect(roundProtectionLevelToGrid(1.38, 2, 0.25)).toBe(1.5);
  });

  it('returns zero and negative values unchanged', () => {
    expect(roundProtectionLevelToGrid(0, 3)).toBe(0);
    expect(roundProtectionLevelToGrid(-1.228444, 3)).toBe(-1.228444);
    expect(roundProtectionLevelToGrid(-5, 2, 0.25)).toBe(-5);
  });
});

describe('unknown broker digits (null) are never guessed', () => {
  it('returns the typed value unrounded and does not throw', () => {
    expect(() => roundProtectionLevelToGrid(1.228444, null)).not.toThrow();
    expect(roundProtectionLevelToGrid(1.228444, null)).toBe(1.228444);
    expect(roundProtectionLevelToGrid(1.228444, null, 0.25)).toBe(1.228444);
  });

  it('readKnownPriceDigits accepts only integers 0..12', () => {
    for (const value of [null, undefined, '', '   ', 2.5, -1, 13, 'abc', Number.NaN, Infinity]) {
      expect(readKnownPriceDigits(value)).toBeNull();
    }
    expect(readKnownPriceDigits('3')).toBe(3);
    expect(readKnownPriceDigits(0)).toBe(0);
    expect(readKnownPriceDigits(12)).toBe(12);
  });
});

describe('protectionLevelViolation side and grid checks', () => {
  const bid = 1.1001;
  const ask = 1.1003;
  const digits = 5;
  const tick = 0.00001;

  it('BUY SL: at Bid blocked, one tick below Bid allowed', () => {
    expect(protectionLevelViolation({ side: 'BUY', role: 'SL', price: bid, bid, ask, digits })).not.toBeNull();
    expect(protectionLevelViolation({
      side: 'BUY', role: 'SL', price: Number((bid - tick).toFixed(digits)), bid, ask, digits,
    })).toBeNull();
  });

  it('BUY TP: one tick above Bid allowed, at Bid blocked', () => {
    expect(protectionLevelViolation({
      side: 'BUY', role: 'TP', price: Number((bid + tick).toFixed(digits)), bid, ask, digits,
    })).toBeNull();
    expect(protectionLevelViolation({ side: 'BUY', role: 'TP', price: bid, bid, ask, digits })).not.toBeNull();
  });

  it('SELL SL: one tick above Ask allowed, at Ask blocked', () => {
    expect(protectionLevelViolation({
      side: 'SELL', role: 'SL', price: Number((ask + tick).toFixed(digits)), bid, ask, digits,
    })).toBeNull();
    expect(protectionLevelViolation({ side: 'SELL', role: 'SL', price: ask, bid, ask, digits })).not.toBeNull();
  });

  it('SELL TP: one tick below Ask allowed', () => {
    expect(protectionLevelViolation({
      side: 'SELL', role: 'TP', price: Number((ask - tick).toFixed(digits)), bid, ask, digits,
    })).toBeNull();
  });

  it('digits null: side check still blocks wrong side, but no grid check', () => {
    expect(protectionLevelViolation({ side: 'BUY', role: 'SL', price: 1.2, bid: 1.1, ask: 1.1002, digits: null })).not.toBeNull();
    expect(protectionLevelViolation({ side: 'BUY', role: 'SL', price: 1.1, bid: 1.1, ask: 1.1002, digits: null })).not.toBeNull();
    expect(protectionLevelViolation({ side: 'SELL', role: 'TP', price: 1.2, bid: 1.1, ask: 1.1002, digits: null })).not.toBeNull();
    // Off-grid on the valid side is NOT reported when precision is unknown.
    expect(protectionLevelViolation({ side: 'BUY', role: 'SL', price: 1.0999987654, bid: 1.1, ask: 1.1002, digits: null })).toBeNull();
    expect(protectionLevelViolation({
      side: 'SELL', role: 'SL', price: 1.2345678, bid: 1.1, ask: 1.1002, digits: null, tickSize: 0.25,
    })).toBeNull();
  });

  it('digits 5: off-grid level on the valid side is reported', () => {
    const violation = protectionLevelViolation({ side: 'BUY', role: 'SL', price: 1.199995, bid: 1.2, ask: 1.2002, digits: 5 });
    expect(violation).not.toBeNull();
    expect(violation).toContain('5-digit');
    expect(protectionLevelViolation({ side: 'BUY', role: 'SL', price: 1.19999, bid: 1.2, ask: 1.2002, digits: 5 })).toBeNull();
  });

  it('tick size 0.25 with digits 2: 100.10 off-grid, 100.25 on-grid', () => {
    expect(protectionLevelViolation({
      side: 'BUY', role: 'TP', price: 100.1, bid: 100, ask: 100.25, digits: 2, tickSize: 0.25,
    })).not.toBeNull();
    expect(protectionLevelViolation({
      side: 'BUY', role: 'TP', price: 100.25, bid: 100, ask: 100.25, digits: 2, tickSize: 0.25,
    })).toBeNull();
  });
});

describe('trade-level drag never falls back to 2 digits', () => {
  it('normalizeTradeLevelDragPrice keeps the raw price when digits are null', () => {
    expect(normalizeTradeLevelDragPrice(1.2345678, null)).toBe(1.2345678);
  });

  it('applyTradeLevelDragUpdate keeps the raw dragged SL when digits are null', () => {
    const update = applyTradeLevelDragUpdate({
      side: 'BUY',
      grabbedType: 'SL',
      entryPrice: 1.3,
      finalPrice: 1.2345678,
      digits: null,
      currentPrice: 1.3,
      minStopDistance: 0,
    });
    expect(update).not.toBeNull();
    expect(update?.role).toBe('SL');
    expect(update?.price).toBe(1.2345678);
    expect(update?.sl).toBe(1.2345678);
  });

  it('digits 5 with zero stop distance: SL one tick below current price is not pushed 5 steps away', () => {
    const update = applyTradeLevelDragUpdate({
      side: 'BUY',
      grabbedType: 'SL',
      entryPrice: 1.1005,
      finalPrice: 1.10009,
      digits: 5,
      currentPrice: 1.1001,
      minStopDistance: 0,
    });
    expect(update?.role).toBe('SL');
    expect(update?.price).toBe(1.10009);
  });

  it('clampTradeLevelToCurrentPrice returns the price unchanged when digits are null', () => {
    expect(clampTradeLevelToCurrentPrice('BUY', 'SL', 1.2, 1.1, 0, null)).toBe(1.2);
  });
});

describe('defaultProtectionLevel', () => {
  it('returns null when digits are unknown', () => {
    expect(defaultProtectionLevel({ side: 'BUY', role: 'SL', bid: 1.1, ask: 1.1002, digits: null })).toBeNull();
    expect(defaultProtectionLevel({ side: 'SELL', role: 'TP', bid: 1.1, ask: 1.1002, digits: null, distancePoints: 10 })).toBeNull();
  });
});
