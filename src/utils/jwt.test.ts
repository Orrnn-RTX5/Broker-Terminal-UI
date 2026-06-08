import { describe, expect, it } from 'vitest';
import { decodeJwtPayload, readJwtClaim } from './jwt';

// Helper to build a base64url-encoded JWT-shaped string with the given payload.
const makeToken = (payload: Record<string, unknown>, opts: { padded?: boolean } = {}): string => {
  const json = JSON.stringify(payload);
  // btoa produces standard base64; convert to base64url and optionally drop padding.
  let body = btoa(json).replace(/\+/g, '-').replace(/\//g, '_');
  if (!opts.padded) body = body.replace(/=+$/, '');
  return `header.${body}.signature`;
};

describe('decodeJwtPayload', () => {
  it('decodes a well-formed token payload', () => {
    const token = makeToken({ account_login: 900123, sub: 'user-1' });
    expect(decodeJwtPayload(token)).toEqual({ account_login: 900123, sub: 'user-1' });
  });

  it('decodes base64url payloads that need padding restored', () => {
    // A payload whose base64 length is not a multiple of 4 (needs '=' padding).
    const token = makeToken({ a: 1 });
    expect(token.split('.')[1]).not.toContain('=');
    expect(decodeJwtPayload(token)).toEqual({ a: 1 });
  });

  it('decodes base64url payloads containing - and _ characters', () => {
    // Pick a value that produces '+' / '/' in standard base64 → '-' / '_' in url form.
    const token = makeToken({ data: 'ÿÿÿ?>>' });
    const decoded = decodeJwtPayload(token);
    expect(decoded).toMatchObject({ data: 'ÿÿÿ?>>' });
  });

  it('returns null for a token without 3 segments', () => {
    expect(decodeJwtPayload('only.two')).toBeNull();
    expect(decodeJwtPayload('a.b.c.d')).toBeNull();
  });

  it('returns null for non-string / empty input', () => {
    expect(decodeJwtPayload('')).toBeNull();
    expect(decodeJwtPayload(undefined)).toBeNull();
    expect(decodeJwtPayload(null)).toBeNull();
    expect(decodeJwtPayload(12345 as unknown)).toBeNull();
  });

  it('returns null when the payload is not valid base64 JSON', () => {
    expect(decodeJwtPayload('header.@@@notbase64@@@.sig')).toBeNull();
  });

  it('returns null when the payload is a JSON array or primitive (not an object)', () => {
    const arrayToken = `header.${btoa('[1,2,3]').replace(/=+$/, '')}.sig`;
    const numberToken = `header.${btoa('42').replace(/=+$/, '')}.sig`;
    expect(decodeJwtPayload(arrayToken)).toBeNull();
    expect(decodeJwtPayload(numberToken)).toBeNull();
  });
});

describe('readJwtClaim', () => {
  it('reads a present claim as a string', () => {
    const token = makeToken({ login: 900456 });
    expect(readJwtClaim(token, 'login')).toBe('900456');
  });

  it('returns undefined for an absent claim or malformed token', () => {
    const token = makeToken({ login: 900456 });
    expect(readJwtClaim(token, 'missing')).toBeUndefined();
    expect(readJwtClaim('garbage', 'login')).toBeUndefined();
  });
});
