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

      expect(reason).not.toBeNull();
      expect(reason!).toContain('Stop loss');
      expect(reason!).toContain('Bid');
      expect(reason!).toContain('BUY');
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

      expect(reason).not.toBeNull();
      expect(reason!).toContain('Take profit');
      expect(reason!).toContain('Bid');
      expect(reason!).toContain('BUY');
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

      expect(reason).not.toBeNull();
      expect(reason!).toContain('Stop loss');
      expect(reason!).toContain('Ask');
      expect(reason!).toContain('SELL');
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

      expect(reason).not.toBeNull();
      expect(reason!).toContain('Take profit');
      expect(reason!).toContain('Ask');
      expect(reason!).toContain('SELL');
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

      expect(reason).not.toBeNull();
      expect(reason!).toContain('Stop loss');
      expect(reason!).toContain('Bid');
      expect(reason!).toContain('BUY');
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

      expect(reason).not.toBeNull();
      expect(reason!).toContain('Take profit');
      expect(reason!).toContain('Ask');
      expect(reason!).toContain('SELL');
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
});
