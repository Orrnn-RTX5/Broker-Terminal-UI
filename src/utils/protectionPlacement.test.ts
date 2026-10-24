import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROTECTION_DISTANCE_POINTS,
  defaultProtectionLevel,
  protectionLevelViolation,
  readDefaultProtectionDistancePoints,
  resolveStopsDistancePoints,
} from './tradeLevelDrag';

// Broker stops-level fixture in points. The seeds below are LITERAL values per named
// fixture (no re-implemented formula): EURUSD's 20-point spread is below this 25-point
// stops level, so its seed is the stops level (25 points = 0.00025); BTCUSD's 50-point
// spread is above it, so its seed is the live spread (0.50).
const STOPS_LEVEL_FIXTURE = 25;

describe('protection initial placement (literal seeds)', () => {
  it('BUY profit seeds SL below Bid (EURUSD): 1.10000 - 0.00025', () => {
    const bid = 1.1;
    const ask = 1.1002;
    const seeded = defaultProtectionLevel({ side: 'BUY', role: 'SL', bid, ask, digits: 5, distancePoints: resolveStopsDistancePoints(STOPS_LEVEL_FIXTURE) });
    expect(Number(seeded)).toBeCloseTo(1.09975, 10);
    expect(protectionLevelViolation({ side: 'BUY', role: 'SL', price: Number(seeded), bid, ask, digits: 5 })).toBeNull();
  });

  it('BUY profit seeds TP above Bid (EURUSD): 1.10000 + 0.00025', () => {
    const bid = 1.1;
    const ask = 1.1002;
    const seeded = defaultProtectionLevel({ side: 'BUY', role: 'TP', bid, ask, digits: 5, distancePoints: resolveStopsDistancePoints(STOPS_LEVEL_FIXTURE) });
    expect(Number(seeded)).toBeCloseTo(1.10025, 10);
    expect(protectionLevelViolation({ side: 'BUY', role: 'TP', price: Number(seeded), bid, ask, digits: 5 })).toBeNull();
  });

  it('BUY loss seeds SL below Bid (BTCUSD): 81486.00 - 0.50', () => {
    const bid = 81486;
    const ask = 81486.5;
    const seeded = defaultProtectionLevel({ side: 'BUY', role: 'SL', bid, ask, digits: 2, distancePoints: resolveStopsDistancePoints(STOPS_LEVEL_FIXTURE) });
    expect(Number(seeded)).toBeCloseTo(81485.5, 6);
    expect(protectionLevelViolation({ side: 'BUY', role: 'SL', price: Number(seeded), bid, ask, digits: 2 })).toBeNull();
  });

  it('BUY loss seeds TP above Bid (BTCUSD): 81486.00 + 0.50', () => {
    const bid = 81486;
    const ask = 81486.5;
    const seeded = defaultProtectionLevel({ side: 'BUY', role: 'TP', bid, ask, digits: 2, distancePoints: resolveStopsDistancePoints(STOPS_LEVEL_FIXTURE) });
    expect(Number(seeded)).toBeCloseTo(81486.5, 6);
    expect(protectionLevelViolation({ side: 'BUY', role: 'TP', price: Number(seeded), bid, ask, digits: 2 })).toBeNull();
  });

  it('SELL profit seeds SL above Ask (EURUSD): 1.10000 + 0.00025', () => {
    const bid = 1.0998;
    const ask = 1.1;
    const seeded = defaultProtectionLevel({ side: 'SELL', role: 'SL', bid, ask, digits: 5, distancePoints: resolveStopsDistancePoints(STOPS_LEVEL_FIXTURE) });
    expect(Number(seeded)).toBeCloseTo(1.10025, 10);
    expect(protectionLevelViolation({ side: 'SELL', role: 'SL', price: Number(seeded), bid, ask, digits: 5 })).toBeNull();
  });

  it('SELL profit seeds TP below Ask (EURUSD): 1.10000 - 0.00025', () => {
    const bid = 1.0998;
    const ask = 1.1;
    const seeded = defaultProtectionLevel({ side: 'SELL', role: 'TP', bid, ask, digits: 5, distancePoints: resolveStopsDistancePoints(STOPS_LEVEL_FIXTURE) });
    expect(Number(seeded)).toBeCloseTo(1.09975, 10);
    expect(protectionLevelViolation({ side: 'SELL', role: 'TP', price: Number(seeded), bid, ask, digits: 5 })).toBeNull();
  });

  it('SELL loss seeds SL above Ask (BTCUSD): 81611.00 + 0.50', () => {
    const bid = 81610.5;
    const ask = 81611;
    const seeded = defaultProtectionLevel({ side: 'SELL', role: 'SL', bid, ask, digits: 2, distancePoints: resolveStopsDistancePoints(STOPS_LEVEL_FIXTURE) });
    expect(Number(seeded)).toBeCloseTo(81611.5, 6);
    expect(protectionLevelViolation({ side: 'SELL', role: 'SL', price: Number(seeded), bid, ask, digits: 2 })).toBeNull();
  });

  it('SELL loss seeds TP below Ask (BTCUSD): 81611.00 - 0.50', () => {
    const bid = 81610.5;
    const ask = 81611;
    const seeded = defaultProtectionLevel({ side: 'SELL', role: 'TP', bid, ask, digits: 2, distancePoints: resolveStopsDistancePoints(STOPS_LEVEL_FIXTURE) });
    expect(Number(seeded)).toBeCloseTo(81610.5, 6);
    expect(protectionLevelViolation({ side: 'SELL', role: 'TP', price: Number(seeded), bid, ask, digits: 2 })).toBeNull();
  });
});

describe('protection exact 12-point gap', () => {
  it('BUY SL with 25 points sits exactly 0.00025 below Bid and is valid', () => {
    const bid = 1.1;
    const ask = 1.1002;
    const digits = 5;
    const close = bid;
    const expected = close - 0.00025;
    const seeded = defaultProtectionLevel({
      side: 'BUY',
      role: 'SL',
      bid,
      ask,
      digits,
      distancePoints: resolveStopsDistancePoints(STOPS_LEVEL_FIXTURE),
    });
    expect(seeded).not.toBeNull();
    const level = Number(seeded);
    expect(level).toBeCloseTo(expected, 10);
    expect(Math.abs(level - close)).toBeCloseTo(0.00025, 10);
    expect(level).toBeLessThan(close);
    expect(protectionLevelViolation({ side: 'BUY', role: 'SL', price: level, bid, ask, digits })).toBeNull();
  });

  it('BUY TP with 25 points sits exactly 0.00025 above Bid and is valid', () => {
    const bid = 1.1;
    const ask = 1.1002;
    const digits = 5;
    const close = bid;
    const expected = close + 0.00025;
    const seeded = defaultProtectionLevel({
      side: 'BUY',
      role: 'TP',
      bid,
      ask,
      digits,
      distancePoints: resolveStopsDistancePoints(STOPS_LEVEL_FIXTURE),
    });
    expect(seeded).not.toBeNull();
    const level = Number(seeded);
    expect(level).toBeCloseTo(expected, 10);
    expect(Math.abs(level - close)).toBeCloseTo(0.00025, 10);
    expect(level).toBeGreaterThan(close);
    expect(protectionLevelViolation({ side: 'BUY', role: 'TP', price: level, bid, ask, digits })).toBeNull();
  });

  it('SELL SL with 25 points sits exactly 0.00025 above Ask and is valid', () => {
    const bid = 1.1;
    const ask = 1.1002;
    const digits = 5;
    const close = ask;
    const expected = close + 0.00025;
    const seeded = defaultProtectionLevel({
      side: 'SELL',
      role: 'SL',
      bid,
      ask,
      digits,
      distancePoints: resolveStopsDistancePoints(STOPS_LEVEL_FIXTURE),
    });
    expect(seeded).not.toBeNull();
    const level = Number(seeded);
    expect(level).toBeCloseTo(expected, 10);
    expect(Math.abs(level - close)).toBeCloseTo(0.00025, 10);
    expect(level).toBeGreaterThan(close);
    expect(protectionLevelViolation({ side: 'SELL', role: 'SL', price: level, bid, ask, digits })).toBeNull();
  });

  it('SELL TP with 25 points sits exactly 0.00025 below Ask and is valid', () => {
    const bid = 1.1;
    const ask = 1.1002;
    const digits = 5;
    const close = ask;
    const expected = close - 0.00025;
    const seeded = defaultProtectionLevel({
      side: 'SELL',
      role: 'TP',
      bid,
      ask,
      digits,
      distancePoints: resolveStopsDistancePoints(STOPS_LEVEL_FIXTURE),
    });
    expect(seeded).not.toBeNull();
    const level = Number(seeded);
    expect(level).toBeCloseTo(expected, 10);
    expect(Math.abs(level - close)).toBeCloseTo(0.00025, 10);
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
