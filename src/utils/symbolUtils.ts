/**
 * Utility functions for symbol formatting and calculations.
 *
 * White-label rule: digits are broker metadata, never derived from the
 * symbol name. Every resolver here is spec-first: it returns
 * broker-provided precision, or null when no usable spec value is in scope.
 * Callers render the raw value (String(value)) when digits are null instead
 * of guessing.
 */

/**
 * Returns the first valid broker-spec digits value from the given sources,
 * or null when none is usable. A valid value is an integer in 0-8, accepted
 * as a number or a numeric string (e.g. tick?.digits, position.digits,
 * instrument.digits, record.digits). Symbol names are never inspected, and
 * there is no fallback constant: unknown precision stays null.
 */
export function resolveSpecDigits(...sources: unknown[]): number | null {
  for (const source of sources) {
    if (typeof source !== 'number' && typeof source !== 'string') continue;
    if (typeof source === 'string' && source.trim() === '') continue;
    const parsed = typeof source === 'number' ? source : Number(source);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 8) continue;
    return parsed;
  }
  return null;
}

/**
 * The terminal's single pip rule, from broker digits only: fractional-pip
 * quotes (3 or 5 digits) count one pip as 10 points; every other precision
 * counts one pip as one point (5 -> 0.0001, 3 -> 0.01, 2 -> 0.01, 4 -> 0.0001).
 * Returns null when no valid spec digits are given (never guessed by name).
 * Shared by spread display, chart trade controls and order sizing so one
 * symbol always shows the same pip count everywhere.
 */
export function getPipExponentFromDigits(digits: unknown): number | null {
  const resolved = resolveSpecDigits(digits);
  if (resolved === null) return null;
  return resolved === 3 || resolved === 5 ? resolved - 1 : resolved;
}

/** Pip size (price units) from broker digits; null when digits are unknown. */
export function getPipSizeFromDigits(digits: unknown): number | null {
  const exponent = getPipExponentFromDigits(digits);
  return exponent === null ? null : 1 / Math.pow(10, exponent);
}

/**
 * Formats a price value with broker-provided digits. Pass broker digits
 * sources (tick?.digits, position.digits, instrument.digits, ...); the first
 * valid integer 0-8 wins. Renders the raw value (String(price)) when no spec
 * digits are available instead of guessing from the symbol name.
 */
export function formatPrice(price: number, ...digitsSources: unknown[]): string {
  // No price: an honest placeholder, never a 5-decimal zero guess.
  if (typeof price !== 'number' || isNaN(price)) return '—';

  const digits = resolveSpecDigits(...digitsSources);
  if (digits === null) return String(price);

  return price.toFixed(digits);
}

/**
 * Parses a string value into a number safely.
 */
export function parsePrice(value: string | number): number {
  if (typeof value === 'number') return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}
