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
 * Formats a price value with broker-provided digits. Pass broker digits
 * sources (tick?.digits, position.digits, instrument.digits, ...); the first
 * valid integer 0-8 wins. Renders the raw value (String(price)) when no spec
 * digits are available instead of guessing from the symbol name.
 */
export function formatPrice(price: number, ...digitsSources: unknown[]): string {
  if (typeof price !== 'number' || isNaN(price)) return '0.00000';

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
