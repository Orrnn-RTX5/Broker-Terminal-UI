import { describe, expect, it } from 'vitest';
import { escapeCsvCell, sanitizeCsvCell, sanitizeCsvRow } from './csvSafety';

describe('sanitizeCsvCell (formula-injection neutralization)', () => {
  it('prefixes leading formula triggers with a single quote', () => {
    expect(sanitizeCsvCell('=1+1')).toBe("'=1+1");
    expect(sanitizeCsvCell('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(sanitizeCsvCell('-2+3')).toBe("'-2+3");
    expect(sanitizeCsvCell('@cmd')).toBe("'@cmd");
    expect(sanitizeCsvCell('\tTAB')).toBe("'\tTAB");
    expect(sanitizeCsvCell('\rCR')).toBe("'\rCR");
  });

  it('leaves benign values untouched', () => {
    expect(sanitizeCsvCell('EURUSD')).toBe('EURUSD');
    expect(sanitizeCsvCell('buy')).toBe('buy');
    expect(sanitizeCsvCell('1.2345')).toBe('1.2345');
  });

  it('coerces non-strings and handles null/undefined', () => {
    expect(sanitizeCsvCell(123)).toBe('123');
    expect(sanitizeCsvCell(null)).toBe('');
    expect(sanitizeCsvCell(undefined)).toBe('');
  });

  it('neutralizes a classic spreadsheet-exec payload', () => {
    const payload = '=HYPERLINK("http://evil","x")';
    expect(sanitizeCsvCell(payload).startsWith("'=")).toBe(true);
  });
});

describe('escapeCsvCell (formula neutralization + RFC 4180 quoting)', () => {
  it('quotes and escapes structurally-dangerous characters', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('he said "hi"')).toBe('"he said ""hi"""');
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralizes formula triggers AND quotes when both apply', () => {
    // "=a,b" must be neutralized to "'=a,b" then quoted because of the comma.
    expect(escapeCsvCell('=a,b')).toBe('"\'=a,b"');
  });

  it('leaves plain values unquoted', () => {
    expect(escapeCsvCell('EURUSD')).toBe('EURUSD');
    expect(escapeCsvCell(42)).toBe('42');
  });
});

describe('sanitizeCsvRow', () => {
  it('neutralizes only string fields, preserving non-strings', () => {
    const row = { symbol: '=EVIL()', volume: 1.5, side: 'buy', profit: -10 };
    expect(sanitizeCsvRow(row)).toEqual({
      symbol: "'=EVIL()",
      volume: 1.5,
      side: 'buy',
      profit: -10,
    });
  });
});
