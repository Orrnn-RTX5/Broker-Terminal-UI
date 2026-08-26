import { describe, expect, it } from 'vitest';
import {
  AUTHENTICATED_SESSION_HANDOFF_MAX_AGE_MS,
  createAuthenticatedSessionHandoff,
  isAuthenticatedSessionHandoffValid,
  parseSessionExpiryMs,
} from './authenticatedSessionHandoff';

describe('authenticated same-document session handoff', () => {
  it('normalizes second, millisecond, and ISO expiries', () => {
    expect(parseSessionExpiryMs(2_000_000_000)).toBe(2_000_000_000_000);
    expect(parseSessionExpiryMs(2_000_000_000_000)).toBe(2_000_000_000_000);
    expect(parseSessionExpiryMs('2030-01-01T00:00:00.000Z')).toBe(Date.parse('2030-01-01T00:00:00.000Z'));
  });

  it('creates a handoff only for a non-expired token and account', () => {
    expect(createAuthenticatedSessionHandoff({ accountId: '', token: 'token' })).toBeNull();
    expect(createAuthenticatedSessionHandoff({ accountId: '200002', token: '' })).toBeNull();
    expect(createAuthenticatedSessionHandoff({
      accountId: '200002',
      token: 'token',
      expiresAt: 999,
      now: 1_000_000,
    })).toBeNull();

    expect(createAuthenticatedSessionHandoff({
      accountId: '200002',
      token: 'token',
      expiresAt: 2_000_000_000_000,
      now: 1_000,
    })).toEqual({
      accountId: '200002',
      token: 'token',
      expiresAt: 2_000_000_000_000,
      committedAt: 1_000,
    });
  });

  it('accepts only a fresh in-memory handoff matching the current token', () => {
    const handoff = createAuthenticatedSessionHandoff({
      accountId: '200002',
      token: 'token',
      expiresAt: 100_000,
      now: 1_000,
    });

    expect(isAuthenticatedSessionHandoffValid(handoff, {
      storedToken: 'token',
      now: 1_100,
    })).toBe(true);
    expect(isAuthenticatedSessionHandoffValid(handoff, {
      storedToken: 'different-token',
      now: 1_100,
    })).toBe(false);
    expect(isAuthenticatedSessionHandoffValid(handoff, {
      storedToken: 'token',
      now: 1_000 + AUTHENTICATED_SESSION_HANDOFF_MAX_AGE_MS + 1,
    })).toBe(false);
  });
});
