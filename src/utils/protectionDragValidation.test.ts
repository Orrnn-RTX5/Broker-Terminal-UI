import { describe, expect, it } from 'vitest';

import {
  applyTradeLevelDragUpdate,
  protectionLevelViolation,
  resolveTradeLevelDragRole,
} from './tradeLevelDrag';

// Pure-utils drag validation: strict side-only backend truth (no distance rule).
// In-gap levels on the correct side are VALID; the clamp absorbing them is correct.
describe('protection drag validation', () => {
  describe('wrong-side drops produce a violation naming the side', () => {
    it('BUY SL dropped above bid is refused as Stop loss vs Bid for BUY', () => {
      const reason = protectionLevelViolation({
        side: 'BUY',
        role: 'SL',
        price: 1.2010,
        bid: 1.2,
        ask: 1.2002,
        digits: 5,
      });

      expect(reason).toBe('SL 1.20100 must be below Bid 1.20000');
    });

    it('BUY TP dropped below bid is refused as Take profit vs Bid for BUY', () => {
      const reason = protectionLevelViolation({
        side: 'BUY',
        role: 'TP',
        price: 1.199,
        bid: 1.2,
        ask: 1.2002,
        digits: 5,
      });

      expect(reason).toBe('TP 1.19900 must be above Bid 1.20000');
    });

    it('SELL SL dropped below ask is refused as Stop loss vs Ask for SELL', () => {
      const reason = protectionLevelViolation({
        side: 'SELL',
        role: 'SL',
        price: 1.199,
        bid: 1.2,
        ask: 1.2002,
        digits: 5,
      });

      expect(reason).toBe('SL 1.19900 must be above Ask 1.20020');
    });

    it('SELL TP dropped above ask is refused as Take profit vs Ask for SELL', () => {
      const reason = protectionLevelViolation({
        side: 'SELL',
        role: 'TP',
        price: 1.201,
        bid: 1.2,
        ask: 1.2002,
        digits: 5,
      });

      expect(reason).toBe('TP 1.20100 must be below Ask 1.20020');
    });
  });

  describe('in-gap drops on the correct side stay valid and clamp', () => {
    it('BUY SL just below bid (2pt inside 5pt gap) has no violation and clamps to the valid side', () => {
      const bid = 1.2;
      const ask = 1.2002;
      const digits = 5;
      const minStopDistance = 0.00005;
      const finalPrice = 1.19998;

      expect(
        protectionLevelViolation({ side: 'BUY', role: 'SL', price: finalPrice, bid, ask, digits }),
      ).toBeNull();

      const update = applyTradeLevelDragUpdate({
        side: 'BUY',
        grabbedType: 'SL',
        entryPrice: 1.201,
        finalPrice,
        digits,
        currentPrice: bid,
        minStopDistance,
      });

      expect(update).not.toBeNull();
      expect(update!.role).toBe('SL');
      expect(update!.price).toBeLessThan(bid);
      expect(
        protectionLevelViolation({ side: 'BUY', role: 'SL', price: update!.price, bid, ask, digits }),
      ).toBeNull();
    });

    it('SELL TP just below ask (2pt inside 5pt gap) has no violation and clamps to the valid side', () => {
      // Valid side for a SELL TP is below Ask, so the correct-side in-gap
      // drop sits just below (not above) Ask.
      const bid = 1.2;
      const ask = 1.2002;
      const digits = 5;
      const minStopDistance = 0.00005;
      const finalPrice = 1.20018;

      expect(
        protectionLevelViolation({ side: 'SELL', role: 'TP', price: finalPrice, bid, ask, digits }),
      ).toBeNull();

      const update = applyTradeLevelDragUpdate({
        side: 'SELL',
        grabbedType: 'TP',
        entryPrice: 1.202,
        finalPrice,
        digits,
        currentPrice: ask,
        minStopDistance,
      });

      expect(update).not.toBeNull();
      expect(update!.role).toBe('TP');
      expect(update!.price).toBeLessThan(ask);
      expect(
        protectionLevelViolation({ side: 'SELL', role: 'TP', price: update!.price, bid, ask, digits }),
      ).toBeNull();
    });
  });

  describe('exact-close drops are refused', () => {
    it('BUY SL exactly at bid is refused', () => {
      const reason = protectionLevelViolation({
        side: 'BUY',
        role: 'SL',
        price: 1.2,
        bid: 1.2,
        ask: 1.2002,
        digits: 5,
      });

      expect(reason).toBe('SL 1.20000 must be below Bid 1.20000');
    });

    it('SELL TP exactly at ask is refused', () => {
      const reason = protectionLevelViolation({
        side: 'SELL',
        role: 'TP',
        price: 1.2002,
        bid: 1.2,
        ask: 1.2002,
        digits: 5,
      });

      expect(reason).toBe('TP 1.20020 must be below Ask 1.20020');
    });
  });

  describe('ENTRY drag role resolution', () => {
    it('BUY ENTRY drag above entry maps to TP', () => {
      expect(resolveTradeLevelDragRole('BUY', 'ENTRY', 1.2, 1.201)).toBe('TP');
    });

    it('BUY ENTRY drag below entry maps to SL', () => {
      expect(resolveTradeLevelDragRole('BUY', 'ENTRY', 1.2, 1.199)).toBe('SL');
    });

    it('SELL ENTRY drag below entry maps to TP', () => {
      expect(resolveTradeLevelDragRole('SELL', 'ENTRY', 1.2, 1.199)).toBe('TP');
    });

    it('SELL ENTRY drag above entry maps to SL', () => {
      expect(resolveTradeLevelDragRole('SELL', 'ENTRY', 1.2, 1.201)).toBe('SL');
    });
  });

  describe('one-tick valid-side drags stay reachable (no stops clamp)', () => {
    // A level one tick on the valid side passes validation (null) and the
    // drag produces a submitted update on the valid side. The pre-existing
    // minimum nudge may still absorb it to the boundary — that is a nudge,
    // not a refusal: the server enforces side + grid, never a stops
    // distance, and the update below always reaches modifyPosition.
    const drag = (side: 'BUY' | 'SELL', role: 'SL' | 'TP', price: number, close: number) => {
      const violation = protectionLevelViolation({ side, role, price, bid: close, ask: close, digits: 5 });
      const update = applyTradeLevelDragUpdate({
        side,
        grabbedType: role,
        entryPrice: side === 'BUY' ? close - 0.002 : close + 0.002,
        finalPrice: price,
        digits: 5,
        currentPrice: close,
      });
      return { violation, update };
    };

    it('BUY SL one tick below Bid is reachable on the valid side', () => {
      const { violation, update } = drag('BUY', 'SL', 1.19999, 1.2);
      expect(violation).toBeNull();
      expect(update).not.toBeNull();
      expect(update!.role).toBe('SL');
      expect(update!.price).toBeLessThan(1.2);
    });

    it('BUY TP one tick above Bid is reachable on the valid side', () => {
      const { violation, update } = drag('BUY', 'TP', 1.20001, 1.2);
      expect(violation).toBeNull();
      expect(update).not.toBeNull();
      expect(update!.role).toBe('TP');
      expect(update!.price).toBeGreaterThan(1.2);
    });

    it('SELL SL one tick above Ask is reachable on the valid side', () => {
      const { violation, update } = drag('SELL', 'SL', 1.20001, 1.2);
      expect(violation).toBeNull();
      expect(update).not.toBeNull();
      expect(update!.role).toBe('SL');
      expect(update!.price).toBeGreaterThan(1.2);
    });

    it('SELL TP one tick below Ask is reachable on the valid side', () => {
      const { violation, update } = drag('SELL', 'TP', 1.19999, 1.2);
      expect(violation).toBeNull();
      expect(update).not.toBeNull();
      expect(update!.role).toBe('TP');
      expect(update!.price).toBeLessThan(1.2);
    });
  });
});
