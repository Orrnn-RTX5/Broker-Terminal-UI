import { describe, expect, it } from 'vitest';
import {
  formatSpreadDisplay,
  formatSpreadDisplayWithUnit,
  getSpreadDisplay,
  resolveRawSpread,
} from './spread';

describe('spread display formatting', () => {
  it('formats non-JPY forex spread in pips', () => {
    expect(formatSpreadDisplay('EURUSD', 0.0002)).toBe('2');
  });

  it('keeps fractional JPY forex spread visible instead of rounding to zero', () => {
    expect(formatSpreadDisplay('USDJPY', 0.001)).toBe('0.1');
  });

  it('formats metal spreads as cent-style points', () => {
    expect(formatSpreadDisplay('XAUUSD', 0.11)).toBe('11');
  });

  it('formats crypto spreads as raw price distance', () => {
    expect(formatSpreadDisplay('BTCUSD', 111.37)).toBe('111.37');
    expect(formatSpreadDisplayWithUnit('ETHUSD', 2.9)).toBe('2.90');
  });

  it('formats index spreads as raw price distance', () => {
    expect(formatSpreadDisplay('US30', 0.7)).toBe('0.70');
  });

  it('falls back to ask minus bid when spread is missing or zero', () => {
    expect(resolveRawSpread(undefined, 7572.9, 7573.2)).toBeCloseTo(0.3, 8);
    expect(formatSpreadDisplay('US500', 0, 7572.9, 7573.2)).toBe('0.30');
  });

  it('keeps real zero spread visible', () => {
    expect(formatSpreadDisplay('EURUSD', 0, 1.16008, 1.16008)).toBe('0');
  });

  it('exposes the unit for callers that need a suffix', () => {
    expect(getSpreadDisplay('EURUSD', 0.0002).unit).toBe('pips');
    expect(getSpreadDisplay('BTCUSD', 111.37).unit).toBe('price');
  });
});
