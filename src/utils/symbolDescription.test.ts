import { describe, expect, it } from 'vitest';

import {
  getFallbackSymbolDescription,
  normalizeSymbolDescriptionText,
  resolveSymbolDescription,
} from './symbolDescription';

describe('getFallbackSymbolDescription', () => {
  it('expands common broker pair symbols', () => {
    expect(getFallbackSymbolDescription('XAUUSD')).toBe('Gold vs US Dollar');
    expect(getFallbackSymbolDescription('XAGSGD')).toBe('Silver vs Singapore Dollar');
    expect(getFallbackSymbolDescription('BTCUSD')).toBe('Bitcoin vs US Dollar');
    expect(getFallbackSymbolDescription('BTCUSD.raw')).toBe('Bitcoin vs US Dollar');
  });

  it('keeps derivative suffixes meaningful', () => {
    expect(getFallbackSymbolDescription('XAGUSD-F')).toBe('Silver vs US Dollar Futures');
    expect(getFallbackSymbolDescription('BTCUSD-PERP')).toBe('Bitcoin vs US Dollar Perpetual');
    expect(getFallbackSymbolDescription('NAS100-F')).toBe('Nasdaq 100 Index Futures');
  });

  it('does not invent a company name for an unknown ticker', () => {
    expect(getFallbackSymbolDescription('AAL.GB')).toBe('');
  });

  it('resolves full pair names when the upstream catalog sends ticker-only or slash-separated labels', () => {
    expect(resolveSymbolDescription('BTCUSD', '')).toBe('Bitcoin vs US Dollar');
    expect(resolveSymbolDescription('BTCUSD', 'BTCUSD')).toBe('Bitcoin vs US Dollar');
    expect(resolveSymbolDescription('BTCUSD', 'BTC/USD')).toBe('Bitcoin vs US Dollar');
    expect(resolveSymbolDescription('BTCUSD', 'Bitcoin / US Dollar')).toBe('Bitcoin vs US Dollar');
    expect(normalizeSymbolDescriptionText('BTCUSD', 'BTC/USD')).toBe('');
    expect(resolveSymbolDescription('XAUUSD', 'Gold Spot')).toBe('Gold Spot');
  });
});

