import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROTECTION_DISTANCE_POINTS,
  defaultProtectionLevel,
  protectionLevelViolation,
  readDefaultProtectionDistancePoints,
  resolveStopsDistancePoints,
} from './tradeLevelDrag';

describe('protection initial placement', () => {
  it('BUY profit seeds SL below Bid (EURUSD)', () => {
    const bid = 1.1;
    const ask = 1.1002;
    const digits = 5;
    // BUY in profit: open below the current market.
    const open = 1.099;
    expect(open).toBeLessThan(bid);
    const close = bid;
    const seeded = defaultProtectionLevel({ side: 'BUY', role: 'SL', bid, ask, digits });
    expect(seeded).not.toBeNull();
    const level = Number(seeded);
    expect(level).toBeLessThan(close);
    expect(Math.abs(level - close)).toBeGreaterThan(0);
    expect(Math.abs(level - close)).toBeCloseTo(
      DEFAULT_PROTECTION_DISTANCE_POINTS * Math.pow(10, -digits),
      10,
    );
    expect(protectionLevelViolation({ side: 'BUY', role: 'SL', price: level, bid, ask, digits })).toBeNull();
  });

  it('BUY profit seeds TP above Bid (EURUSD)', () => {
    const bid = 1.1;
    const ask = 1.1002;
    const digits = 5;
    // BUY in profit: open below the current market.
    const open = 1.099;
    expect(open).toBeLessThan(bid);
    const close = bid;
    const seeded = defaultProtectionLevel({ side: 'BUY', role: 'TP', bid, ask, digits });
    expect(seeded).not.toBeNull();
    const level = Number(seeded);
    expect(level).toBeGreaterThan(close);
    expect(Math.abs(level - close)).toBeGreaterThan(0);
    expect(Math.abs(level - close)).toBeCloseTo(
      DEFAULT_PROTECTION_DISTANCE_POINTS * Math.pow(10, -digits),
      10,
    );
    expect(protectionLevelViolation({ side: 'BUY', role: 'TP', price: level, bid, ask, digits })).toBeNull();
  });

  it('BUY loss seeds SL below Bid (BTCUSD)', () => {
    const bid = 81486;
    const ask = 81486.5;
    const digits = 2;
    // BUY in loss: open above the current market.
    const open = 81611;
    expect(open).toBeGreaterThan(bid);
    const close = bid;
    const seeded = defaultProtectionLevel({ side: 'BUY', role: 'SL', bid, ask, digits });
    expect(seeded).not.toBeNull();
    const level = Number(seeded);
    expect(level).toBeLessThan(close);
    expect(Math.abs(level - close)).toBeGreaterThan(0);
    expect(Math.abs(level - close)).toBeCloseTo(
      DEFAULT_PROTECTION_DISTANCE_POINTS * Math.pow(10, -digits),
      10,
    );
    expect(protectionLevelViolation({ side: 'BUY', role: 'SL', price: level, bid, ask, digits })).toBeNull();
  });

  it('BUY loss seeds TP above Bid (BTCUSD)', () => {
    const bid = 81486;
    const ask = 81486.5;
    const digits = 2;
    // BUY in loss: open above the current market.
    const open = 81611;
    expect(open).toBeGreaterThan(bid);
    const close = bid;
    const seeded = defaultProtectionLevel({ side: 'BUY', role: 'TP', bid, ask, digits });
    expect(seeded).not.toBeNull();
    const level = Number(seeded);
    expect(level).toBeGreaterThan(close);
    expect(Math.abs(level - close)).toBeGreaterThan(0);
    expect(Math.abs(level - close)).toBeCloseTo(
      DEFAULT_PROTECTION_DISTANCE_POINTS * Math.pow(10, -digits),
      10,
    );
    expect(protectionLevelViolation({ side: 'BUY', role: 'TP', price: level, bid, ask, digits })).toBeNull();
  });

  it('SELL profit seeds SL above Ask (EURUSD)', () => {
    const bid = 1.0998;
    const ask = 1.1;
    const digits = 5;
    // SELL in profit: open above the current market.
    const open = 1.101;
    expect(open).toBeGreaterThan(ask);
    const close = ask;
    const seeded = defaultProtectionLevel({ side: 'SELL', role: 'SL', bid, ask, digits });
    expect(seeded).not.toBeNull();
    const level = Number(seeded);
    expect(level).toBeGreaterThan(close);
    expect(Math.abs(level - close)).toBeGreaterThan(0);
    expect(Math.abs(level - close)).toBeCloseTo(
      DEFAULT_PROTECTION_DISTANCE_POINTS * Math.pow(10, -digits),
      10,
    );
    expect(protectionLevelViolation({ side: 'SELL', role: 'SL', price: level, bid, ask, digits })).toBeNull();
  });

  it('SELL profit seeds TP below Ask (EURUSD)', () => {
    const bid = 1.0998;
    const ask = 1.1;
    const digits = 5;
    // SELL in profit: open above the current market.
    const open = 1.101;
    expect(open).toBeGreaterThan(ask);
    const close = ask;
    const seeded = defaultProtectionLevel({ side: 'SELL', role: 'TP', bid, ask, digits });
    expect(seeded).not.toBeNull();
    const level = Number(seeded);
    expect(level).toBeLessThan(close);
    expect(Math.abs(level - close)).toBeGreaterThan(0);
    expect(Math.abs(level - close)).toBeCloseTo(
      DEFAULT_PROTECTION_DISTANCE_POINTS * Math.pow(10, -digits),
      10,
    );
    expect(protectionLevelViolation({ side: 'SELL', role: 'TP', price: level, bid, ask, digits })).toBeNull();
  });

  it('SELL loss seeds SL above Ask (BTCUSD)', () => {
    const bid = 81610.5;
    const ask = 81611;
    const digits = 2;
    // SELL in loss: open below the current market.
    const open = 81486;
    expect(open).toBeLessThan(ask);
    const close = ask;
    const seeded = defaultProtectionLevel({ side: 'SELL', role: 'SL', bid, ask, digits });
    expect(seeded).not.toBeNull();
    const level = Number(seeded);
    expect(level).toBeGreaterThan(close);
    expect(Math.abs(level - close)).toBeGreaterThan(0);
    expect(Math.abs(level - close)).toBeCloseTo(
      DEFAULT_PROTECTION_DISTANCE_POINTS * Math.pow(10, -digits),
      10,
    );
    expect(protectionLevelViolation({ side: 'SELL', role: 'SL', price: level, bid, ask, digits })).toBeNull();
  });

  it('SELL loss seeds TP below Ask (BTCUSD)', () => {
    const bid = 81610.5;
    const ask = 81611;
    const digits = 2;
    // SELL in loss: open below the current market.
    const open = 81486;
    expect(open).toBeLessThan(ask);
    const close = ask;
    const seeded = defaultProtectionLevel({ side: 'SELL', role: 'TP', bid, ask, digits });
    expect(seeded).not.toBeNull();
    const level = Number(seeded);
    expect(level).toBeLessThan(close);
    expect(Math.abs(level - close)).toBeGreaterThan(0);
    expect(Math.abs(level - close)).toBeCloseTo(
      DEFAULT_PROTECTION_DISTANCE_POINTS * Math.pow(10, -digits),
      10,
    );
    expect(protectionLevelViolation({ side: 'SELL', role: 'TP', price: level, bid, ask, digits })).toBeNull();
  });
});

describe('protection exact 12-point gap', () => {
  it('BUY SL with 12 points sits exactly 0.00012 below Bid and is valid', () => {
    const bid = 1.1;
    const ask = 1.1002;
    const digits = 5;
    const close = bid;
    const expected = close - 0.00012;
    const seeded = defaultProtectionLevel({
      side: 'BUY',
      role: 'SL',
      bid,
      ask,
      digits,
      distancePoints: 12,
    });
    expect(seeded).not.toBeNull();
    const level = Number(seeded);
    expect(level).toBeCloseTo(expected, 10);
    expect(Math.abs(level - close)).toBeCloseTo(0.00012, 10);
    expect(level).toBeLessThan(close);
    expect(protectionLevelViolation({ side: 'BUY', role: 'SL', price: level, bid, ask, digits })).toBeNull();
  });

  it('BUY TP with 12 points sits exactly 0.00012 above Bid and is valid', () => {
    const bid = 1.1;
    const ask = 1.1002;
    const digits = 5;
    const close = bid;
    const expected = close + 0.00012;
    const seeded = defaultProtectionLevel({
      side: 'BUY',
      role: 'TP',
      bid,
      ask,
      digits,
      distancePoints: 12,
    });
    expect(seeded).not.toBeNull();
    const level = Number(seeded);
    expect(level).toBeCloseTo(expected, 10);
    expect(Math.abs(level - close)).toBeCloseTo(0.00012, 10);
    expect(level).toBeGreaterThan(close);
    expect(protectionLevelViolation({ side: 'BUY', role: 'TP', price: level, bid, ask, digits })).toBeNull();
  });

  it('SELL SL with 12 points sits exactly 0.00012 above Ask and is valid', () => {
    const bid = 1.1;
    const ask = 1.1002;
    const digits = 5;
    const close = ask;
    const expected = close + 0.00012;
    const seeded = defaultProtectionLevel({
      side: 'SELL',
      role: 'SL',
      bid,
      ask,
      digits,
      distancePoints: 12,
    });
    expect(seeded).not.toBeNull();
    const level = Number(seeded);
    expect(level).toBeCloseTo(expected, 10);
    expect(Math.abs(level - close)).toBeCloseTo(0.00012, 10);
    expect(level).toBeGreaterThan(close);
    expect(protectionLevelViolation({ side: 'SELL', role: 'SL', price: level, bid, ask, digits })).toBeNull();
  });

  it('SELL TP with 12 points sits exactly 0.00012 below Ask and is valid', () => {
    const bid = 1.1;
    const ask = 1.1002;
    const digits = 5;
    const close = ask;
    const expected = close - 0.00012;
    const seeded = defaultProtectionLevel({
      side: 'SELL',
      role: 'TP',
      bid,
      ask,
      digits,
      distancePoints: 12,
    });
    expect(seeded).not.toBeNull();
    const level = Number(seeded);
    expect(level).toBeCloseTo(expected, 10);
    expect(Math.abs(level - close)).toBeCloseTo(0.00012, 10);
    expect(level).toBeLessThan(close);
    expect(protectionLevelViolation({ side: 'SELL', role: 'TP', price: level, bid, ask, digits })).toBeNull();
  });
});

describe('protection distance config', () => {
  it('broker stopsLevel wins over runtime SLTP_DEFAULT_DISTANCE_POINTS', () => {
    const runtimeWindow = window as unknown as {
      __RTX_RUNTIME_CONFIG__?: Record<string, unknown>;
    };
    const previous = runtimeWindow.__RTX_RUNTIME_CONFIG__;
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { SLTP_DEFAULT_DISTANCE_POINTS: 30 };
    try {
      expect(resolveStopsDistancePoints(12)).toBe(12);
    } finally {
      if (previous === undefined) {
        delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
      } else {
        runtimeWindow.__RTX_RUNTIME_CONFIG__ = previous;
      }
    }
  });

  it('runtime SLTP_DEFAULT_DISTANCE_POINTS wins over built-in 5', () => {
    expect(DEFAULT_PROTECTION_DISTANCE_POINTS).toBe(5);
    const runtimeWindow = window as unknown as {
      __RTX_RUNTIME_CONFIG__?: Record<string, unknown>;
    };
    const previous = runtimeWindow.__RTX_RUNTIME_CONFIG__;
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { SLTP_DEFAULT_DISTANCE_POINTS: 18 };
    try {
      expect(readDefaultProtectionDistancePoints()).toBe(18);
      expect(resolveStopsDistancePoints(undefined)).toBe(18);
    } finally {
      if (previous === undefined) {
        delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
      } else {
        runtimeWindow.__RTX_RUNTIME_CONFIG__ = previous;
      }
    }
  });
});
