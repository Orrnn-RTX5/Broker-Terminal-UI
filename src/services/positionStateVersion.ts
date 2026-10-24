/**
 * Position state versions reach the terminal either as JSON numbers (3) or as decimal
 * strings (bigint-safe: "3"). Both normalise to one canonical digit string, which is
 * also what the store keeps. Anything else is unversioned (null): it never reads as
 * newer or older, and it never throws.
 */
export const readPositionStateVersion = (value: unknown): string | null => {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, '') : null;
};
