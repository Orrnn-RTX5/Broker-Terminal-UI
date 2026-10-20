import { describe, expect, it } from 'vitest';

import { formatMarketWatchExportPrice } from './marketWatchPanelModel';

/**
 * Null/unknown-digits rendering contract for formatMarketWatchExportPrice
 * (TERM-DIGITS-WL).
 *
 * This file exercises only the pure export-price formatter — no store state,
 * no DOM. When the instrument carries no usable digit count, a finite price
 * must be rendered as the raw String(value): never rounded, never a
 * fallback-constant precision. The synthetic token below is deliberately not
 * a real instrument; it only stands in for "digits unknown". There are NO
 * per-name precision expectations here.
 *
 * NOTE (pre-fix): the formatter currently routes unknown instruments through
 * the name-table lookup (a fixed constant precision), so the "raw value"
 * tests below currently FAIL. The non-finite control tests pass both before
 * and after the fix.
 */

const UNKNOWN_DIGITS_TOKEN = '__UNKNOWN_WL__';

const RAW_PRICES = [1.123456789, 1.5, 150.1234, 0.000012345, 67895.4321, 100] as const;

describe('formatMarketWatchExportPrice with null/unknown digits', () => {
  it.each(RAW_PRICES)('renders the raw value %s for an instrument without digits', (value) => {
    expect(formatMarketWatchExportPrice(UNKNOWN_DIGITS_TOKEN, value)).toBe(String(value));
  });

  it('accepts numeric-string values without rounding', () => {
    expect(formatMarketWatchExportPrice(UNKNOWN_DIGITS_TOKEN, '1.123456789')).toBe(
      String(1.123456789),
    );
  });

  it('never substitutes a rounded fallback-constant precision', () => {
    // A fixed 5-decimal fallback would render '1.12346'; the contract is raw.
    const result = formatMarketWatchExportPrice(UNKNOWN_DIGITS_TOKEN, 1.123456789);
    expect(result).toBe(String(1.123456789));
    expect(result).not.toBe((1.123456789).toFixed(5));
  });

  it('still returns the empty placeholder for non-finite or zero values', () => {
    expect(formatMarketWatchExportPrice(UNKNOWN_DIGITS_TOKEN, 0)).toBe('-');
    expect(formatMarketWatchExportPrice(UNKNOWN_DIGITS_TOKEN, Number.NaN)).toBe('-');
    expect(formatMarketWatchExportPrice(UNKNOWN_DIGITS_TOKEN, null)).toBe('-');
    expect(formatMarketWatchExportPrice(UNKNOWN_DIGITS_TOKEN, undefined)).toBe('-');
  });
});
