import { describe, expect, it } from 'vitest';
import { parsePositiveLogin } from './sessionIdentity';

describe('parsePositiveLogin', () => {
  it('accepts positive integer account identifiers', () => {
    expect(parsePositiveLogin('123456')).toBe(123456);
    expect(parsePositiveLogin(' 42 ')).toBe(42);
  });

  it('rejects missing and non-positive identifiers', () => {
    expect(parsePositiveLogin(undefined)).toBeNull();
    expect(parsePositiveLogin('')).toBeNull();
    expect(parsePositiveLogin('0')).toBeNull();
    expect(parsePositiveLogin('-7')).toBeNull();
    expect(parsePositiveLogin('not-a-login')).toBeNull();
  });
});
