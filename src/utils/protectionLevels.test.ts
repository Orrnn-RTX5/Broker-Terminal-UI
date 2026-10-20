import { describe, expect, it, vi, afterEach } from 'vitest';

import {
  DEFAULT_PROTECTION_DISTANCE_POINTS,
  defaultProtectionLevel,
  protectionLevelViolation,
  readDefaultProtectionDistancePoints,
  resolveStopsDistancePoints,
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

    it('offsets by the stops distance and rounds to digits', () => {
      const sl = defaultProtectionLevel({ side: 'BUY', role: 'SL', bid: 82000, ask: 82001, digits: 2, distancePoints: 10 });
      expect(sl).toBeCloseTo(81999.9, 10);
      const tp = defaultProtectionLevel({ side: 'SELL', role: 'TP', bid: 81799, ask: 81800, digits: 2, distancePoints: 10 });
      expect(tp).toBeCloseTo(81799.9, 10);
    });

    it('returns null without a usable close price', () => {
      expect(defaultProtectionLevel({ side: 'BUY', role: 'SL', bid: 0, ask: 0, digits: 2 })).toBeNull();
    });
  });

  describe('protectionLevelViolation: drag validation names the reason', () => {
    it.each([
      ['BUY', 'SL', 82010, 82000, 'Stop loss must be below the current Bid'],
      ['BUY', 'TP', 81990, 82000, 'Take profit must be above the current Bid'],
      ['SELL', 'SL', 81990, 82000, 'Stop loss must be above the current Ask'],
      ['SELL', 'TP', 82010, 82000, 'Take profit must be below the current Ask'],
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
      expect(reason!).toContain(side);
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
      ['BUY', 'SL', 82000, 'Stop loss must be below the current Bid'],
      ['BUY', 'TP', 82000, 'Take profit must be above the current Bid'],
      ['SELL', 'SL', 82000, 'Stop loss must be above the current Ask'],
      ['SELL', 'TP', 82000, 'Take profit must be below the current Ask'],
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
      expect(message).toContain('Stop loss must be below the current Bid');
      expect(message).toContain('81,486');
      expect(message).toContain('BUY');
    });

    it.each(['INVALID_STOPS', 'INVALID_SL_TP', 'PROTECTION_VIOLATION', 'STOPS_LEVEL_VIOLATION'])(
      'maps sibling code %s', (code) => {
        const message = describeProtectionRefusal(
          { status: 400, code, message: 'x', data: { code, message: 'x' } },
          { side: 'SELL', sl: 0, tp: 82010, bid: 81999, ask: 82000, digits: 2 },
        );
        expect(message).toContain('Take profit must be below the current Ask');
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
