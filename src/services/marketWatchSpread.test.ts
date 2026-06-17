import { describe, expect, it } from 'vitest';
import { formatMarketWatchSpread } from './marketWatchSpread';

describe('market watch spread formatting', () => {
  it('shows BTC spread in price units instead of forex points', () => {
    expect(formatMarketWatchSpread(12, 'BTCUSD')).toBe('12.00');
    expect(formatMarketWatchSpread(12, 'BTCUSD.r')).toBe('12.00');
  });

  it('shows metals in price units', () => {
    expect(formatMarketWatchSpread(0.07, 'XAUUSD')).toBe('0.07');
  });

  it('keeps forex spread in point-style display', () => {
    expect(formatMarketWatchSpread(0.00002, 'GBPUSD')).toBe('0');
    expect(formatMarketWatchSpread(0.021, 'USDJPY')).toBe('2');
  });

  it('handles unavailable spread values defensively', () => {
    expect(formatMarketWatchSpread(Number.NaN, 'BTCUSD')).toBe('-');
    expect(formatMarketWatchSpread(-1, 'BTCUSD')).toBe('-');
  });
});
