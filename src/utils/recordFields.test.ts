import { describe, expect, it } from 'vitest';
import { readFirstFiniteNumber, readFirstNonEmptyString } from './recordFields';

describe('readFirstFiniteNumber', () => {
  it('skips absent, empty, and non-finite aliases before reading a numeric string', () => {
    const record = {
      nullValue: null,
      empty: '',
      invalid: 'unknown',
      nan: Number.NaN,
      infinity: Number.POSITIVE_INFINITY,
      value: ' 12.5 ',
    };

    expect(readFirstFiniteNumber(record, [
      'missing', 'nullValue', 'empty', 'invalid', 'nan', 'infinity', 'value',
    ])).toBe(12.5);
  });

  it('keeps alias priority and a real zero instead of taking a later value', () => {
    const record = { primary: 0, fallback: 25 };

    expect(readFirstFiniteNumber(record, ['primary', 'fallback'])).toBe(0);
    expect(readFirstFiniteNumber(record, ['fallback', 'primary'])).toBe(25);
  });

  it.each([
    [-2, -2],
    ['-2.5', -2.5],
    [' ', 0],
    [false, 0],
    [true, 1],
  ])('preserves existing Number conversion for %j', (value, expected) => {
    expect(readFirstFiniteNumber({ value }, ['value'])).toBe(expected);
  });

  it('leaves an absent or invalid value undefined', () => {
    expect(readFirstFiniteNumber({}, ['volume', 'tick_volume'])).toBeUndefined();
    expect(readFirstFiniteNumber({ volume: '' }, ['volume'])).toBeUndefined();
    expect(readFirstFiniteNumber({ volume: 'Infinity' }, ['volume'])).toBeUndefined();
    expect(readFirstFiniteNumber({ volume: 12 }, [])).toBeUndefined();
  });
});

describe('readFirstNonEmptyString', () => {
  it('skips non-string and blank aliases and trims the first usable string', () => {
    expect(readFirstNonEmptyString({
      nullValue: null,
      number: 123,
      boolean: true,
      empty: '',
      whitespace: ' \t ',
      provider: ' Prime LP ',
      fallback: 'Other LP',
    }, [
      'missing', 'nullValue', 'number', 'boolean', 'empty', 'whitespace', 'provider', 'fallback',
    ])).toBe('Prime LP');
  });

  it('uses alias priority when multiple strings are present', () => {
    expect(readFirstNonEmptyString({ lp: ' LP ', provider: ' Provider ' }, [
      'provider', 'lp',
    ])).toBe('Provider');
  });

  it('leaves missing or blank values undefined', () => {
    expect(readFirstNonEmptyString({}, ['lp', 'provider'])).toBeUndefined();
    expect(readFirstNonEmptyString({ lp: ' ' }, ['lp'])).toBeUndefined();
    expect(readFirstNonEmptyString({ lp: 'LP' }, [])).toBeUndefined();
  });
});
