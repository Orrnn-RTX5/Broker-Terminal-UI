import { describe, expect, it, vi, afterEach } from 'vitest';

import {
  DEFAULT_PROTECTION_DISTANCE_POINTS,
  DEFAULT_QUOTE_MAX_AGE_MS,
  defaultProtectionLevel,
  protectionLevelViolation,
  readDefaultProtectionDistancePoints,
  readLiveSpreadPoints,
  readQuoteMaxAgeMs,
  resolveDropPriceForRole,
  resolveFreshValidationQuote,
  resolveSeedDistancePoints,
  resolveSeedDistancePrice,
  resolveStopsDistancePoints,
  resolveTradeLevelDragRole,
} from './tradeLevelDrag';
import { describeProtectionRefusal } from './orderError';

const invalidStops = (message = 'protection level violates the current closing price') => ({
  status: 400,
  code: 'INVALID_STOPS',
  message,
  data: { code: 'INVALID_STOPS', message },
});

describe('protection geometry (SL/TP user experience)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as { __RTX_RUNTIME_CONFIG__?: unknown }).__RTX_RUNTIME_CONFIG__;
  });

  describe('defaultProtectionLevel: fresh flows start on the valid side', () => {
    // BUY in profit (market above open) and in loss (below open).
    it.each([
      ['profit', 82000, 81900],
      ['loss', 81800, 81900],
    ])('BUY %s: SL below Bid, TP above Bid', (_label, bid, _open) => {
      const sl = defaultProtectionLevel({ side: 'BUY', role: 'SL', bid, ask: bid + 1, digits: 2 });
      const tp = defaultProtectionLevel({ side: 'BUY', role: 'TP', bid, ask: bid + 1, digits: 2 });
      expect(sl).not.toBeNull();
      expect(tp).not.toBeNull();
      expect(sl!).toBeLessThan(bid);
      expect(tp!).toBeGreaterThan(bid);
    });

    // SELL in profit (market below open) and in loss (above open).
    it.each([
      ['profit', 81800, 81900],
      ['loss', 82000, 81900],
    ])('SELL %s: SL above Ask, TP below Ask', (_label, ask, _open) => {
      const sl = defaultProtectionLevel({ side: 'SELL', role: 'SL', bid: ask - 1, ask, digits: 2 });
      const tp = defaultProtectionLevel({ side: 'SELL', role: 'TP', bid: ask - 1, ask, digits: 2 });
      expect(sl).not.toBeNull();
      expect(tp).not.toBeNull();
      expect(sl!).toBeGreaterThan(ask);
      expect(tp!).toBeLessThan(ask);
    });

    it('the live spread wins when it is wider than the stops level', () => {
      // Spread 1.00 = 100 points > stops 10 points: the seed is the spread.
      const sl = defaultProtectionLevel({ side: 'BUY', role: 'SL', bid: 82000, ask: 82001, digits: 2, distancePoints: 10 });
      expect(sl).toBeCloseTo(81999, 10);
      const tp = defaultProtectionLevel({ side: 'SELL', role: 'TP', bid: 81800, ask: 81801, digits: 2, distancePoints: 10 });
      expect(tp).toBeCloseTo(81800, 10);
    });

    it('the stops level wins when it is wider than the live spread', () => {
      // Spread 0.05 = 5 points < stops 10 points: the seed is the stops level.
      const sl = defaultProtectionLevel({ side: 'BUY', role: 'SL', bid: 82000, ask: 82000.05, digits: 2, distancePoints: 10 });
      expect(sl).toBeCloseTo(81999.9, 10);
      const tp = defaultProtectionLevel({ side: 'SELL', role: 'TP', bid: 81799.95, ask: 81800, digits: 2, distancePoints: 10 });
      expect(tp).toBeCloseTo(81799.9, 10);
    });

    it('a seed with a tick size rounds outward onto the tick (never inside the distance)', () => {
      // Spread 0.32 at 2 digits, tick 0.05: raw seed 81736.22 moves down to the tick.
      const sl = defaultProtectionLevel({ side: 'BUY', role: 'SL', bid: 81736.54, ask: 81736.86, digits: 2, tickSize: 0.05 });
      expect(sl).toBeCloseTo(81736.2, 10);
      expect(protectionLevelViolation({ side: 'BUY', role: 'SL', price: Number(sl), bid: 81736.54, ask: 81736.86, digits: 2, tickSize: 0.05 })).toBeNull();
    });

    it('returns null without a usable close price', () => {
      expect(defaultProtectionLevel({ side: 'BUY', role: 'SL', bid: 0, ask: 0, digits: 2 })).toBeNull();
    });
  });

  describe('protectionLevelViolation: drag validation names the reason', () => {
    it.each([
      ['BUY', 'SL', 82010, 82000, 'SL 82,010.00 must be below Bid 82,000.00'],
      ['BUY', 'TP', 81990, 82000, 'TP 81,990.00 must be above Bid 82,000.00'],
      ['SELL', 'SL', 81990, 82000, 'SL 81,990.00 must be above Ask 82,000.00'],
      ['SELL', 'TP', 82010, 82000, 'TP 82,010.00 must be below Ask 82,000.00'],
    ])('%s %s at %s vs %s is invalid with a plain-words reason', (side, role, price, close, prefix) => {
      const reason = protectionLevelViolation({
        side: side as 'BUY' | 'SELL',
        role: role as 'SL' | 'TP',
        price,
        bid: close,
        ask: close,
        digits: 2,
      });
      expect(reason).not.toBeNull();
      expect(reason!).toContain(prefix);
      expect(reason!).toContain(role);
    });

    it.each([
      ['BUY', 'SL', 81990, 82000],
      ['BUY', 'TP', 82010, 82000],
      ['SELL', 'SL', 82010, 82000],
      ['SELL', 'TP', 81990, 82000],
    ])('%s %s at %s vs %s is valid (null)', (side, role, price, close) => {
      expect(protectionLevelViolation({
        side: side as 'BUY' | 'SELL',
        role: role as 'SL' | 'TP',
        price,
        bid: close,
        ask: close,
        digits: 2,
      })).toBeNull();
    });

    // One tick on the valid side is ALLOWED (no minimum distance anywhere).
    it.each([
      ['BUY', 'SL', 81999.99, 82000],
      ['BUY', 'TP', 82000.01, 82000],
      ['SELL', 'SL', 82000.01, 82000],
      ['SELL', 'TP', 81999.99, 82000],
    ])('%s %s one tick off %s is allowed (null)', (side, role, price, close) => {
      expect(protectionLevelViolation({
        side: side as 'BUY' | 'SELL',
        role: role as 'SL' | 'TP',
        price,
        bid: close,
        ask: close,
        digits: 2,
      })).toBeNull();
    });

    // Exact equality with the close is refused (strict rule).
    it.each([
      ['BUY', 'SL', 82000, 'SL 82,000.00 must be below Bid 82,000.00'],
      ['BUY', 'TP', 82000, 'TP 82,000.00 must be above Bid 82,000.00'],
      ['SELL', 'SL', 82000, 'SL 82,000.00 must be above Ask 82,000.00'],
      ['SELL', 'TP', 82000, 'TP 82,000.00 must be below Ask 82,000.00'],
    ])('%s %s exactly at the close is blocked', (side, role, price, prefix) => {
      const reason = protectionLevelViolation({
        side: side as 'BUY' | 'SELL',
        role: role as 'SL' | 'TP',
        price,
        bid: 82000,
        ask: 82000,
        digits: 2,
      });
      expect(reason).not.toBeNull();
      expect(reason!).toContain(prefix);
    });

    // Off-grid levels are blocked with the grid reason.
    it.each([
      ['BUY', 'SL', 81999.995],
      ['BUY', 'TP', 82000.005],
      ['SELL', 'SL', 82000.005],
      ['SELL', 'TP', 81999.995],
    ])('%s %s off the 2-digit grid is blocked', (side, role, price) => {
      const reason = protectionLevelViolation({
        side: side as 'BUY' | 'SELL',
        role: role as 'SL' | 'TP',
        price,
        bid: 82000,
        ask: 82000,
        digits: 2,
      });
      expect(reason).not.toBeNull();
      expect(reason!).toContain('2-digit price grid');
    });
  });

  describe('describeProtectionRefusal: toast mapping', () => {
    it('names the offending BUY SL against the live Bid (owner case)', () => {
      // BUY 0.01 @ 81611, market ~81486, SL submitted above Bid.
      const message = describeProtectionRefusal(invalidStops(), {
        side: 'BUY', sl: 81500, tp: 0, bid: 81486, ask: 81487, digits: 2,
      });
      expect(message).toContain('SL 81,500.00 must be below Bid 81,486.00');
      expect(message).toContain('81,486');
      expect(message).toContain('Bid');
    });

    it.each(['INVALID_STOPS', 'INVALID_SL_TP', 'PROTECTION_VIOLATION', 'STOPS_LEVEL_VIOLATION'])(
      'maps sibling code %s', (code) => {
        const message = describeProtectionRefusal(
          { status: 400, code, message: 'x', data: { code, message: 'x' } },
          { side: 'SELL', sl: 0, tp: 82010, bid: 81999, ask: 82000, digits: 2 },
        );
        expect(message).toContain('TP 82,010.00 must be below Ask 82,000.00');
      },
    );

    it('returns null for non-protection errors (existing paths unchanged)', () => {
      expect(describeProtectionRefusal(
        { status: 403, code: 'FORBIDDEN', message: 'x', data: { code: 'FORBIDDEN', message: 'x' } },
        { side: 'BUY', sl: 1, tp: 2, bid: 3, ask: 4, digits: 2 },
      )).toBeNull();
    });

    it('falls back to the server message when levels look valid (moved quote)', () => {
      const message = describeProtectionRefusal(invalidStops('custom server text'), {
        side: 'BUY', sl: 81400, tp: 81570, bid: 81486, ask: 81487, digits: 2,
      });
      expect(message).toBe('custom server text');
    });
  });

  describe('stops distance resolution', () => {
    it('prefers an explicit stops level, else the runtime-config default, else 5', () => {
      expect(resolveStopsDistancePoints(20)).toBe(20);
      expect(resolveStopsDistancePoints(undefined)).toBe(DEFAULT_PROTECTION_DISTANCE_POINTS);
      (window as unknown as { __RTX_RUNTIME_CONFIG__?: unknown }).__RTX_RUNTIME_CONFIG__ = {
        SLTP_DEFAULT_DISTANCE_POINTS: 12,
      };
      expect(readDefaultProtectionDistancePoints()).toBe(12);
      expect(resolveStopsDistancePoints(undefined)).toBe(12);
      (window as unknown as { __RTX_RUNTIME_CONFIG__?: unknown }).__RTX_RUNTIME_CONFIG__ = {
        SLTP_DEFAULT_DISTANCE_POINTS: 'nope',
      };
      expect(readDefaultProtectionDistancePoints()).toBe(DEFAULT_PROTECTION_DISTANCE_POINTS);
    });
  });
});

// Live close drives role, drop and refusal (SL/TP x BUY/SELL x profit/loss).
// Prices are generic examples; nothing here is symbol-specific.
describe('live close drives role, drop and refusal (SL/TP x BUY/SELL x profit/loss)', () => {
  describe('ENTRY-line drop role is decided against the live close', () => {
    it.each([
      // side, entry, close (Bid for BUY, Ask for SELL), drop, expected role
      ['BUY', 81000, 81736.54, 81500, 'SL'], // BUY profit: below Bid -> SL
      ['BUY', 81000, 81736.54, 82000, 'TP'], // BUY profit: above Bid -> TP
      ['BUY', 82000, 81700, 81800, 'TP'], // BUY loss: above Bid -> TP
      ['BUY', 82000, 81700, 81600, 'SL'], // BUY loss: below Bid -> SL
      ['SELL', 82000, 81300, 81500, 'SL'], // SELL profit: above Ask -> SL
      ['SELL', 82000, 81300, 81200, 'TP'], // SELL profit: below Ask -> TP
      ['SELL', 81000, 81500, 81200, 'TP'], // SELL loss: below Ask -> TP
      ['SELL', 81000, 81500, 81800, 'SL'], // SELL loss: above Ask -> SL
    ] as const)('%s entry %s close %s drop %s is %s', (side, entry, close, drop, role) => {
      expect(resolveTradeLevelDragRole(side, 'ENTRY', entry, drop, close)).toBe(role);
    });

    it('falls back to the entry price only when no live close exists', () => {
      expect(resolveTradeLevelDragRole('BUY', 'ENTRY', 81000, 81500)).toBe('TP');
      expect(resolveTradeLevelDragRole('BUY', 'ENTRY', 81000, 81500, null)).toBe('TP');
      expect(resolveTradeLevelDragRole('SELL', 'ENTRY', 81000, 81500, undefined)).toBe('SL');
    });

    it('a role chosen against the close is never refused by the side check', () => {
      // BUY profit: 81500 is below Bid, so as SL it is valid.
      const role = resolveTradeLevelDragRole('BUY', 'ENTRY', 81000, 81500, 81736.54);
      expect(protectionLevelViolation({ side: 'BUY', role, price: 81500, bid: 81736.54, ask: 81791.54, digits: 2 })).toBeNull();
    });
  });

  describe('refusal names the attempted level and the bound (broker digits)', () => {
    it.each([
      // side, role, attempted price, bid, ask, expected text
      ['BUY', 'SL', 81760, 81736.54, 81791.54, 'SL 81,760.00 must be below Bid 81,736.54'], // profit
      ['BUY', 'TP', 81700, 81736.54, 81791.54, 'TP 81,700.00 must be above Bid 81,736.54'], // profit
      ['BUY', 'SL', 81100, 81000, 81055, 'SL 81,100.00 must be below Bid 81,000.00'], // loss
      ['BUY', 'TP', 80900, 81000, 81055, 'TP 80,900.00 must be above Bid 81,000.00'], // loss
      ['SELL', 'SL', 81780, 81736.54, 81791.54, 'SL 81,780.00 must be above Ask 81,791.54'], // profit
      ['SELL', 'TP', 81800, 81736.54, 81791.54, 'TP 81,800.00 must be below Ask 81,791.54'], // profit
      ['SELL', 'SL', 81000, 81000, 81055, 'SL 81,000.00 must be above Ask 81,055.00'], // loss
      ['SELL', 'TP', 81100, 81000, 81055, 'TP 81,100.00 must be below Ask 81,055.00'], // loss
    ] as const)('%s %s at %s vs Bid %s / Ask %s -> %s', (side, role, price, bid, ask, text) => {
      expect(protectionLevelViolation({ side, role, price, bid, ask, digits: 2 })).toBe(text);
    });
  });

  describe('drop price for a level not set yet (chip) stays on the valid side of the live close', () => {
    // Live spread 55.00 at 2 digits (5500 points) is the seed distance.
    const bid = 81736.54;
    const ask = 81791.54;

    it.each([
      // side, grabbed, dropped price, expected submitted price
      ['BUY', 'SL', 81760, 81681.54], // wrong side (above Bid): snapped to Bid - seed
      ['BUY', 'SL', 81000, 81000], // valid and beyond the seed: kept
      ['BUY', 'TP', 81740, 81791.54], // short drag above Bid: snapped to Bid + seed
      ['BUY', 'TP', 82000, 82000], // valid and beyond the seed: kept
      ['SELL', 'SL', 81791, 81846.54], // wrong side (below Ask): snapped to Ask + seed
      ['SELL', 'SL', 82000, 82000], // valid and beyond the seed: kept
      ['SELL', 'TP', 81800, 81736.54], // short drag below Ask: snapped to Ask - seed
      ['SELL', 'TP', 81000, 81000], // valid and beyond the seed: kept
    ] as const)('%s chip %s dropped at %s submits %s', (side, grabbedType, price, expected) => {
      const submitted = resolveDropPriceForRole({
        side, grabbedType, price, quote: { bid, ask }, digits: 2, isNewLevel: true,
      });
      expect(submitted).toBeCloseTo(expected, 6);
      expect(protectionLevelViolation({ side, role: grabbedType, price: submitted, bid, ask, digits: 2 })).toBeNull();
    });

    it('existing levels and entry drops keep the dropped price (a wrong-side drop is refused)', () => {
      expect(resolveDropPriceForRole({ side: 'BUY', grabbedType: 'SL', price: 81760, quote: { bid, ask }, digits: 2, isNewLevel: false })).toBe(81760);
      expect(resolveDropPriceForRole({ side: 'BUY', grabbedType: 'ENTRY', price: 81500, quote: { bid, ask }, digits: 2, isNewLevel: true })).toBe(81500);
    });

    it('without a fresh quote there is no close to snap to: the dropped price goes to the server as-is', () => {
      expect(resolveDropPriceForRole({ side: 'BUY', grabbedType: 'SL', price: 81760, quote: null, digits: 2, isNewLevel: true })).toBe(81760);
    });

    it('snaps a chip OUTWARD onto a tick size of 0.05 so the grid check passes (spread 0.32, not a tick multiple)', () => {
      const bid = 81736.54;
      const ask = 81736.86;
      const tick = { digits: 2, tickSize: 0.05, isNewLevel: true, quote: { bid, ask } } as const;
      // BUY SL above Bid: clamped to Bid - 0.32 = 81736.22, rounded DOWN to the tick.
      const sl = resolveDropPriceForRole({ side: 'BUY', grabbedType: 'SL', price: 81740, ...tick });
      expect(sl).toBeCloseTo(81736.2, 6);
      // BUY TP below Bid: clamped to Bid + 0.32 = 81736.86, rounded UP.
      const tp = resolveDropPriceForRole({ side: 'BUY', grabbedType: 'TP', price: 81700, ...tick });
      expect(tp).toBeCloseTo(81736.9, 6);
      // SELL SL below Ask: Ask + 0.32 = 81737.18, rounded UP.
      const sellSl = resolveDropPriceForRole({ side: 'SELL', grabbedType: 'SL', price: 81700, ...tick });
      expect(sellSl).toBeCloseTo(81737.2, 6);
      // SELL TP above Ask: Ask - 0.32 = 81736.54, rounded DOWN.
      const sellTp = resolveDropPriceForRole({ side: 'SELL', grabbedType: 'TP', price: 81800, ...tick });
      expect(sellTp).toBeCloseTo(81736.5, 6);
      for (const [side, role, price] of [['BUY', 'SL', sl], ['BUY', 'TP', tp], ['SELL', 'SL', sellSl], ['SELL', 'TP', sellTp]] as const) {
        expect(protectionLevelViolation({ side, role, price, bid, ask, digits: 2, tickSize: 0.05 })).toBeNull();
      }
    });

    it('the chip seed includes the catalog stops level when it is wider than the live spread', () => {
      // Spread 0.32 (32 points); catalog stops 50 points: the seed is 0.50 from the close.
      const submitted = resolveDropPriceForRole({
        side: 'BUY', grabbedType: 'SL', price: 81740, quote: { bid: 81736.54, ask: 81736.86 },
        digits: 2, tickSize: 0.05, stopsLevel: 50, isNewLevel: true,
      });
      expect(submitted).toBeCloseTo(81736, 6);
    });
  });

  describe('seed distance = max(stops level if the catalog has one, live spread, buffer)', () => {
    it('uses the live spread and never a small catalog spread (live 55, catalog 10 points)', () => {
      // The catalog spread field is never an input; only the live bid/ask seed the level.
      expect(resolveSeedDistancePrice({ bid: 81736.54, ask: 81791.54, digits: 2 })).toBeCloseTo(55, 6);
      const sl = defaultProtectionLevel({ side: 'BUY', role: 'SL', bid: 81736.54, ask: 81791.54, digits: 2 });
      expect(sl).toBeCloseTo(81681.54, 6);
      expect(protectionLevelViolation({ side: 'BUY', role: 'SL', price: Number(sl), bid: 81736.54, ask: 81791.54, digits: 2 })).toBeNull();
    });

    it('a catalog stops level larger than the live spread still wins', () => {
      expect(resolveSeedDistancePoints(20, 10)).toBe(20);
      expect(resolveSeedDistancePoints(20, 5500)).toBe(5500);
    });

    it('falls back to the buffer when there is no stops level and no live spread', () => {
      expect(resolveSeedDistancePoints(undefined, null)).toBe(DEFAULT_PROTECTION_DISTANCE_POINTS);
      expect(resolveSeedDistancePoints(0, 0)).toBe(DEFAULT_PROTECTION_DISTANCE_POINTS);
    });

    it('never seeds when the precision is unknown', () => {
      expect(readLiveSpreadPoints(81736.54, 81791.54, null)).toBeNull();
      expect(resolveSeedDistancePrice({ bid: 81736.54, ask: 81791.54, digits: null })).toBeNull();
    });
  });

  describe('validation quote freshness: only a feed stamp counts (server-final otherwise)', () => {
    const now = 1_800_000_000_000;
    const quoteSides = { bid: 81736.54, ask: 81791.54 };

    it('a stamped two-sided quote within the age is fresh', () => {
      expect(resolveFreshValidationQuote(quoteSides, now, 60_000, now - 1000)).toEqual({ bid: 81736.54, ask: 81791.54 });
    });

    it('a stamp older than the age is stale, even when the broker time looks fresh', () => {
      const freshBroker = { ...quoteSides, timestamp: now, sourceTimestamp: now };
      expect(resolveFreshValidationQuote(freshBroker, now, 60_000, now - 60_001)).toBeNull();
      expect(resolveFreshValidationQuote(freshBroker, now, 60_000, now - 60_000)).toEqual(quoteSides);
    });

    it('a two-sided quote with no feed stamp is not fresh, even with a broker timestamp (server-final)', () => {
      expect(resolveFreshValidationQuote({ ...quoteSides, timestamp: now, sourceTimestamp: now }, now, 60_000, undefined)).toBeNull();
      expect(resolveFreshValidationQuote({ ...quoteSides }, now, 60_000, null)).toBeNull();
    });

    it('a two-sided quote with no timestamp and no stamp is not fresh (no default freshness)', () => {
      expect(resolveFreshValidationQuote({ ...quoteSides }, now, 60_000, undefined)).toBeNull();
    });

    it('a broker time far in the future does not make a quote fresh', () => {
      const futureBroker = { ...quoteSides, timestamp: now + 3_600_000, sourceTimestamp: now + 3_600_000 };
      expect(resolveFreshValidationQuote(futureBroker, now, 60_000, undefined)).toBeNull();
    });

    it('a missing, one-sided or zero-priced tick is never fresh', () => {
      expect(resolveFreshValidationQuote(undefined, now, 60_000, now)).toBeNull();
      expect(resolveFreshValidationQuote({ bid: 0, ask: 1.1 }, now, 60_000, now)).toBeNull();
      expect(resolveFreshValidationQuote({ bid: 1, ask: undefined }, now, 60_000, now)).toBeNull();
    });

    it('reads the age knob from runtime config with a generic default', () => {
      const runtime = window as unknown as { __RTX_RUNTIME_CONFIG__?: unknown };
      try {
        expect(readQuoteMaxAgeMs()).toBe(DEFAULT_QUOTE_MAX_AGE_MS);
        runtime.__RTX_RUNTIME_CONFIG__ = { QUOTE_MAX_AGE_MS: 15000 };
        expect(readQuoteMaxAgeMs()).toBe(15000);
        runtime.__RTX_RUNTIME_CONFIG__ = { VITE_QUOTE_MAX_AGE_MS: '30000' };
        expect(readQuoteMaxAgeMs()).toBe(30000);
        runtime.__RTX_RUNTIME_CONFIG__ = { QUOTE_MAX_AGE_MS: 'nope' };
        expect(readQuoteMaxAgeMs()).toBe(DEFAULT_QUOTE_MAX_AGE_MS);
      } finally {
        delete runtime.__RTX_RUNTIME_CONFIG__;
      }
    });
  });
});
