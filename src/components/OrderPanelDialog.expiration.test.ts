import { describe, expect, it } from 'vitest';

import { resolveDialogExpirationTimestamp } from './OrderPanelDialog';

// Fixed "now": 2026-06-15T12:00:00 local. All expectations are derived from
// the same local clock, so no timezone is hardcoded.
const NOW = new Date(2026, 5, 15, 12, 0, 0, 0).getTime();

describe('resolveDialogExpirationTimestamp (SUI-T2)', () => {
  it('omits expiry for GTC', () => {
    expect(resolveDialogExpirationTimestamp('GTC', '15.06.26 12:00', NOW)).toBeUndefined();
  });

  it('resolves Today to end of the current local day', () => {
    const expected = new Date(2026, 5, 15, 23, 59, 59, 0).getTime() / 1000;
    expect(resolveDialogExpirationTimestamp('Today', 'does not matter', NOW)).toBe(expected);
  });

  it('resolves Specified to the exact local datetime', () => {
    const expected = new Date(2026, 5, 20, 14, 30, 0, 0).getTime() / 1000;
    expect(resolveDialogExpirationTimestamp('Specified', '20.06.26 14:30', NOW)).toBe(expected);
  });

  it('resolves Specified day to end of the selected local date', () => {
    const expected = new Date(2026, 5, 20, 23, 59, 59, 0).getTime() / 1000;
    expect(resolveDialogExpirationTimestamp('Specified day', '20.06.26 00:01', NOW)).toBe(expected);
  });

  it('blocks past and unparseable dated values fail-closed (never 0/NaN)', () => {
    expect(() => resolveDialogExpirationTimestamp('Specified', '10.06.26 12:00', NOW)).toThrow('future');
    expect(() => resolveDialogExpirationTimestamp('Specified', 'not-a-date', NOW)).toThrow('valid expiration');
    expect(() => resolveDialogExpirationTimestamp('Specified', '31.02.26 12:00', NOW)).toThrow('valid expiration');
    expect(() => resolveDialogExpirationTimestamp('Specified day', '10.06.26 23:59', NOW)).toThrow('future');
  });

  it('emits whole epoch seconds', () => {
    const value = resolveDialogExpirationTimestamp('Specified', '20.06.26 14:30', NOW)!;
    expect(Number.isInteger(value)).toBe(true);
  });
});
