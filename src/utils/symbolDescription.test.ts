import { describe, expect, it } from 'vitest';

import { getFallbackSymbolDescription } from './symbolDescription';

describe('getFallbackSymbolDescription', () => {
  it('expands common broker pair symbols', () => {
    expect(getFallbackSymbolDescription('XAUUSD')).toBe('Gold vs US Dollar');
    expect(getFallbackSymbolDescription('XAGSGD')).toBe('Silver vs Singapore Dollar');
    expect(getFallbackSymbolDescription('BTCUSD')).toBe('Bitcoin vs US Dollar');
  });

  it('keeps derivative suffixes meaningful', () => {
    expect(getFallbackSymbolDescription('XAGUSD-F')).toBe('Silver vs US Dollar Futures');
    expect(getFallbackSymbolDescription('BTCUSD-PERP')).toBe('Bitcoin vs US Dollar Perpetual');
    expect(getFallbackSymbolDescription('NAS100-F')).toBe('Nasdaq 100 Index Futures');
  });

  it('does not invent a company name for an unknown ticker', () => {
    expect(getFallbackSymbolDescription('AAL.GB')).toBe('');
  });
});

