import { describe, expect, it } from 'vitest';

import { formatPriceParts } from './PriceDisplay';

/**
 * Null/unknown-digits rendering contract for formatPriceParts (TERM-DIGITS-WL).
 *
 * This file exercises only the pure string formatter — the React component is
 * never rendered, so no DOM is involved. When no usable digit count is
 * available, the formatter must return the raw String(price) as a single
 * part: never rounded, never split from a fallback-constant precision. The
 * synthetic token below is deliberately not a real instrument; it only stands
 * in for "digits unknown". There are NO per-name precision expectations here.
 *
 * NOTE (pre-fix): formatPriceParts currently falls back to the name-table
 * lookup for missing/invalid digits, so the "raw value" tests below currently
 * FAIL. The explicit-digits control tests pass both before and after the fix.
 */

const UNKNOWN_DIGITS_TOKEN = '__UNKNOWN_WL__';

const RAW_PRICES = [1.123456789, 1.5, 150.1234, 0.000012345, 67895.4321, 100] as const;

describe('formatPriceParts with null/unknown digits', () => {
  it.each(RAW_PRICES)('returns the raw value %s as a single part when digits are missing', (price) => {
    expect(formatPriceParts(price, UNKNOWN_DIGITS_TOKEN)).toEqual({
      small: String(price),
      big: '',
    });
    expect(formatPriceParts(price, UNKNOWN_DIGITS_TOKEN, undefined)).toEqual({
      small: String(price),
      big: '',
    });
  });

  it.each(RAW_PRICES)('returns the raw value %s as a single part for nullish/NaN digits', (price) => {
    expect(formatPriceParts(price, UNKNOWN_DIGITS_TOKEN, null as unknown as number)).toEqual(
      {
        small: String(price),
        big: '',
      },
    );
    expect(
      formatPriceParts(price, UNKNOWN_DIGITS_TOKEN, Number.NaN),
    ).toEqual({ small: String(price), big: '' });
  });

  it('never substitutes a rounded fallback-constant split', () => {
    // A fixed 5-decimal fallback would split 1.123456789 into small '1.123'
    // big '46' (rounded); the contract is the raw value with no big part.
    const result = formatPriceParts(1.123456789, UNKNOWN_DIGITS_TOKEN);
    expect(result).toEqual({ small: String(1.123456789), big: '' });
    expect(result.small).not.toBe('1.123');
  });

  it('still honors an explicit valid digit count', () => {
    expect(formatPriceParts(1.33601, UNKNOWN_DIGITS_TOKEN, 5)).toEqual({
      small: '1.336',
      big: '01',
    });
    expect(formatPriceParts(67895.43, UNKNOWN_DIGITS_TOKEN, 2)).toEqual({
      small: '67895.',
      big: '43',
    });
  });
});
