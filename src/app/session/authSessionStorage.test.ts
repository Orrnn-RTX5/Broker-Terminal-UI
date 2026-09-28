import { describe, expect, it } from 'vitest';
import { hasTokenExpiryElapsed, parseStoredTokenExpiryMs } from './authSessionStorage';

describe('auth session storage helpers', () => {
  it('normalizes epoch seconds and milliseconds', () => {
    expect(parseStoredTokenExpiryMs(1_800_000_000)).toBe(1_800_000_000_000);
    expect(parseStoredTokenExpiryMs('1800000000000')).toBe(1_800_000_000_000);
  });

  it('accepts ISO timestamps and rejects empty or invalid values', () => {
    expect(parseStoredTokenExpiryMs('2026-09-28T00:00:00.000Z')).toBe(Date.parse('2026-09-28T00:00:00.000Z'));
    expect(parseStoredTokenExpiryMs('')).toBeNull();
    expect(parseStoredTokenExpiryMs('not-a-date')).toBeNull();
  });

  it('checks expiration against an injected clock', () => {
    expect(hasTokenExpiryElapsed(100, 100_000)).toBe(true);
    expect(hasTokenExpiryElapsed(101, 100_000)).toBe(false);
  });
});
