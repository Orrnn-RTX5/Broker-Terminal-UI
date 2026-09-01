import { describe, expect, it } from 'vitest';
import {
  buildDrawingContextKey,
  buildDrawingStorageKey,
  isSameDrawingContext,
  type DrawingContextIdentity,
} from './contextKey';

const identity = (overrides: Partial<DrawingContextIdentity> = {}): DrawingContextIdentity => ({
  contextId: 'chart-xauusd-m1',
  symbol: 'XAUUSD',
  timeframe: 'M1',
  accountScope: 'GTA:primary-account',
  ...overrides,
});

describe('drawing context identity', () => {
  it('builds normalized account, symbol, and timeframe ownership keys', () => {
    expect(buildDrawingContextKey(identity({ symbol: ' xauusd ', timeframe: ' m5 ' })))
      .toBe('GTA:primary-account::XAUUSD::M5');
    expect(buildDrawingStorageKey(identity({ symbol: ' xauusd ', timeframe: ' m5 ' })))
      .toBe('drawings-GTA%3Aprimary-account-XAUUSD-M5');
  });

  it('preserves legacy storage compatibility when account scope is absent', () => {
    expect(buildDrawingContextKey({ symbol: ' eurusd ', timeframe: ' h1 ' }))
      .toBe('legacy::EURUSD::H1');
    expect(buildDrawingStorageKey({ symbol: ' eurusd ', timeframe: ' h1 ' }))
      .toBe('drawings-EURUSD-H1');
  });

  it('does not invent a runtime symbol or timeframe for blank context fields', () => {
    expect(buildDrawingContextKey({ symbol: ' ', timeframe: '', accountScope: ' ' }))
      .toBe('legacy::::');
    expect(() => buildDrawingStorageKey({ symbol: ' ', timeframe: '', accountScope: ' ' }))
      .toThrow('Drawing storage requires the active symbol and timeframe');
  });

  it('keeps symbol, timeframe, and account buckets distinct', () => {
    const keys = [
      identity(),
      identity({ symbol: 'BTCUSD' }),
      identity({ timeframe: 'M5' }),
      identity({ accountScope: 'GTA:secondary-account' }),
    ].map(buildDrawingContextKey);

    expect(new Set(keys)).toHaveLength(4);
  });

  it('compares mounted chart ownership by context id rather than symbol alone', () => {
    expect(isSameDrawingContext(identity(), identity({ symbol: 'BTCUSD', timeframe: 'M5' }))).toBe(true);
    expect(isSameDrawingContext(identity(), identity({ contextId: 'chart-b' }))).toBe(false);
    expect(isSameDrawingContext(identity(), null)).toBe(false);
    expect(isSameDrawingContext(undefined, identity())).toBe(false);
  });
});
