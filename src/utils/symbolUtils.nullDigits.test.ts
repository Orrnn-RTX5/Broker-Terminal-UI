import { describe, expect, it } from 'vitest';

import { formatPrice } from './symbolUtils';

/**
 * Null/unknown-digits rendering contract for formatPrice (TERM-DIGITS-WL).
 *
 * When no usable digit count is supplied, the formatter must render the raw
 * String(value): never rounded, never a fallback-constant precision. There
 * are intentionally NO symbol-name expectations in this file.
 *
 * NOTE (pre-fix): formatPrice currently falls back to the name-table lookup
 * (a fixed constant precision) for missing/invalid digits, so the "raw value"
 * tests below currently FAIL. The explicit-digits control tests pass both
 * before and after the fix.
 */

const RAW_VALUES = [1.123456789, 1.5, 150.1234, 0.000012345, 67895.4321, 100] as const;

describe('formatPrice with null/unknown digits', () => {
  it.each(RAW_VALUES)('renders the raw value %s when no digits are supplied', (value) => {
    expect(formatPrice(value)).toBe(String(value));
  });

  it.each(RAW_VALUES)('renders the raw value %s for nullish/NaN digits', (value) => {
    expect(formatPrice(value, undefined)).toBe(String(value));
    expect(formatPrice(value, null as unknown as number)).toBe(String(value));
    expect(formatPrice(value, Number.NaN)).toBe(String(value));
  });

  it.each(RAW_VALUES)(
    'renders the raw value %s for out-of-range or fractional digits instead of rounding',
    (value) => {
      expect(formatPrice(value, 9)).toBe(String(value));
      expect(formatPrice(value, -1)).toBe(String(value));
      expect(formatPrice(value, 2.5)).toBe(String(value));
    },
  );

  it('renders the raw value for non-numeric digits instead of rounding', () => {
    const value = 1.123456789;
    expect(formatPrice(value, 'not-a-precision' as unknown as number)).toBe(String(value));
  });

  it('never substitutes a fixed fallback-constant precision', () => {
    // A fixed 5-decimal fallback would render '1.50000'; the contract is raw.
    expect(formatPrice(1.5)).not.toBe((1.5).toFixed(5));
    expect(formatPrice(1.5)).toBe(String(1.5));
  });

  it('still honors an explicit valid digit count', () => {
    expect(formatPrice(1.123456789, 2)).toBe('1.12');
    expect(formatPrice(1.123456789, 5)).toBe('1.12346');
    expect(formatPrice(100, 0)).toBe('100');
  });
});
