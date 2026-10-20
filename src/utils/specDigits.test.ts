import { describe, expect, it } from 'vitest';

import * as symbolUtils from './symbolUtils';

/**
 * Spec-first digit resolution contract (TERM-DIGITS-WL).
 *
 * The resolver takes an ordered list of broker/spec digit sources and returns
 * the first valid integer in the 0-8 range (numeric strings accepted — broker
 * JSON payloads carry them). Anything else (null, undefined, NaN, negatives,
 * >8, non-integers, booleans, objects) is skipped. When no source is valid
 * the result is null — never a name-derived fallback constant. There are
 * intentionally NO symbol-name expectations in this file.
 *
 * NOTE (pre-removal): `resolveSpecDigits` does not exist in symbolUtils yet —
 * only the old name-table lookup does — so every test below currently FAILS
 * at the resolver loader. That failure is the point: these tests pin the new
 * contract and go green once the spec-first resolver lands.
 */

type SpecDigitsResolver = (...sources: unknown[]) => number | null;

const loadResolver = (): SpecDigitsResolver => {
  const candidate = (symbolUtils as unknown as { resolveSpecDigits?: unknown })
    .resolveSpecDigits;
  expect(
    typeof candidate,
    'resolveSpecDigits is missing from symbolUtils: the spec-first resolver edit has not landed yet',
  ).toBe('function');
  return candidate as SpecDigitsResolver;
};

describe('resolveSpecDigits (spec-first digit resolution)', () => {
  it('is exported from symbolUtils', () => {
    loadResolver();
  });

  it('returns null when no sources are provided', () => {
    expect(loadResolver()()).toBeNull();
  });

  it('returns null (never a fallback constant) when every source is missing', () => {
    const resolve = loadResolver();
    expect(resolve(null)).toBeNull();
    expect(resolve(undefined)).toBeNull();
    expect(resolve(null, undefined, Number.NaN)).toBeNull();
  });

  it('accepts the boundary digits 0 and 8', () => {
    const resolve = loadResolver();
    expect(resolve(0)).toBe(0);
    expect(resolve(8)).toBe(8);
  });

  it('lets the first valid integer 0-8 win', () => {
    const resolve = loadResolver();
    expect(resolve(null, 2, 5)).toBe(2);
    expect(resolve(undefined, null, 0, 5)).toBe(0);
    expect(resolve(Number.NaN, 7, 1)).toBe(7);
    // Numeric strings are broker-realistic (JSON payloads): accepted.
    expect(resolve('3', 4)).toBe(3);
  });

  it('skips out-of-range integers', () => {
    const resolve = loadResolver();
    expect(resolve(-1, 9, 3)).toBe(3);
    expect(resolve(-1)).toBeNull();
    expect(resolve(9)).toBeNull();
    expect(resolve(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('skips non-integer numbers', () => {
    const resolve = loadResolver();
    expect(resolve(2.5, 4)).toBe(4);
    expect(resolve(2.5)).toBeNull();
    expect(resolve(Number.NaN)).toBeNull();
  });

  it('skips booleans and objects; numeric strings are accepted (broker JSON)', () => {
    const resolve = loadResolver();
    expect(resolve('5')).toBe(5);
    expect(resolve('3', 4)).toBe(3);
    expect(resolve('', 6)).toBe(6);
    expect(resolve(true, 1)).toBe(1);
    expect(resolve({}, [], 2)).toBe(2);
  });

  it('preserves 0 even though it is falsy', () => {
    const resolve = loadResolver();
    const result = resolve(null, 0);
    expect(result).not.toBeNull();
    expect(result).toBe(0);
  });
});
