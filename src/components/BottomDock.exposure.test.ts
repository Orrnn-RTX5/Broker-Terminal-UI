import { describe, expect, it } from 'vitest';

import {
  buildExposureSummary,
  formatExposureVolume,
  parseExposureSymbol,
} from './BottomDock.exposure';

describe('BottomDock exposure helpers', () => {
  it('parses forex, metal, and crypto symbols into base and quote assets', () => {
    expect(parseExposureSymbol('GBPUSD')).toEqual({ base: 'GBP', quote: 'USD' });
    expect(parseExposureSymbol('XAUUSD')).toEqual({ base: 'XAU', quote: 'USD' });
    expect(parseExposureSymbol('BTCUSD.r')).toEqual({ base: 'BTC', quote: 'USD' });
  });

  it('allocates used margin to the traded asset and remaining free margin to account currency', () => {
    const summary = buildExposureSummary(
      [{
        symbol: 'XAUUSD',
        side: 'BUY',
        volume: 0.01,
        currentPrice: 4326.095,
      }],
      {
        balance: 3328.65,
        equity: 3322.30,
        margin: 8.65,
        freeMargin: 3313.65,
        marginLevel: 38408.09,
        currency: 'USD',
        leverage: 500,
      }
    );

    const usd = summary.rows.find((row) => row.asset === 'USD');
    const xau = summary.rows.find((row) => row.asset === 'XAU');

    expect(usd?.value).toBeCloseTo(3305.00, 2);
    expect(xau?.volume).toBeCloseTo(1, 5);
    expect(xau?.rate).toBeCloseTo(4326.095, 5);
    expect(xau?.value).toBeCloseTo(8.65, 2);
    expect(summary.longSegments.map((segment) => segment.asset)).toEqual(['USD', 'XAU']);
  });

  it('keeps short assets negative and renders them as short graph values', () => {
    const summary = buildExposureSummary(
      [{
        symbol: 'GBPUSD',
        side: 'SELL',
        volume: 0.02,
        currentPrice: 1.34,
      }],
      {
        balance: 1000,
        equity: 1000,
        margin: 26.8,
        freeMargin: 973.2,
        currency: 'USD',
      }
    );

    const gbp = summary.rows.find((row) => row.asset === 'GBP');
    expect(gbp?.volume).toBeCloseTo(-2000, 5);
    expect(gbp?.value).toBeCloseTo(-26.8, 2);
    expect(gbp?.shortValue).toBeCloseTo(26.8, 2);
  });

  it('formats MT-style compact volume labels', () => {
    expect(formatExposureVolume('USD', 3305)).toBe('3.305K');
    expect(formatExposureVolume('GBP', -2000)).toBe('-2.000K');
    expect(formatExposureVolume('XAU', 1)).toBe('1.00');
  });
});
