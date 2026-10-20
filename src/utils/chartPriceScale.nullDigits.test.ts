import { describe, expect, it } from 'vitest';

import { formatChartAxisPrice } from './chartPriceScale';

/**
 * Null/unknown-digits rendering contract for formatChartAxisPrice
 * (TERM-DIGITS-WL).
 *
 * When no usable digit count is supplied, the axis formatter must render the
 * raw String(price): never rounded, never grouped by a fallback-constant
 * precision. There are intentionally NO symbol-name expectations here.
 *
 * NOTE (pre-fix): formatChartAxisPrice currently falls back to a fixed
 * 2-decimal Intl precision for missing/invalid digits, so the "raw value"
 * tests below currently FAIL. The explicit-digits control tests pass both
 * before and after the fix.
 */

const RAW_PRICES = [1.123456789, 1.125, 4417.2456, 100, 0.000012345] as const;

describe('formatChartAxisPrice with null/unknown digits', () => {
  it.each(RAW_PRICES)('renders the raw value %s for nullish/NaN digits', (price) => {
    expect(formatChartAxisPrice(price, undefined as unknown as number)).toBe(String(price));
    expect(formatChartAxisPrice(price, null as unknown as number)).toBe(String(price));
    expect(formatChartAxisPrice(price, Number.NaN)).toBe(String(price));
  });

  it.each(RAW_PRICES)(
    'renders the raw value %s for out-of-range or fractional digits instead of rounding',
    (price) => {
      expect(formatChartAxisPrice(price, -1)).toBe(String(price));
      expect(formatChartAxisPrice(price, 13)).toBe(String(price));
      expect(formatChartAxisPrice(price, 2.5)).toBe(String(price));
    },
  );

  it('never rounds to a fixed fallback-constant precision', () => {
    // A fixed 2-decimal fallback would round 1.125 up to '1.13' and group
    // 4417.2456 as '4,417.25'; the contract is the raw value in both cases.
    expect(formatChartAxisPrice(1.125, Number.NaN)).toBe(String(1.125));
    expect(formatChartAxisPrice(1.125, Number.NaN)).not.toBe('1.13');
    expect(formatChartAxisPrice(4417.2456, undefined as unknown as number)).toBe(
      String(4417.2456),
    );
  });

  it('still honors an explicit valid digit count', () => {
    expect(formatChartAxisPrice(4417.2, 2)).toBe('4,417.20');
    expect(formatChartAxisPrice(1.1637, 5)).toBe('1.16370');
    expect(formatChartAxisPrice(78216, 0)).toBe('78,216');
  });
});
