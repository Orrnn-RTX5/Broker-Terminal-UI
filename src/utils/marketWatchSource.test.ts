import { describe, expect, it } from 'vitest';
import { shouldUseWatchlistAsMarketWatchSource } from './marketWatchSource';

describe('Market Watch symbol source', () => {
  it('does not let a built-in default watchlist limit the Market Watch rows', () => {
    expect(shouldUseWatchlistAsMarketWatchSource({
      activeWatchlistId: 'majors',
      activeWatchlistIsDefault: true,
    })).toBe(false);
  });

  it('keeps all available symbols when the watchlist metadata is missing', () => {
    expect(shouldUseWatchlistAsMarketWatchSource({
      activeWatchlistId: 'majors',
      activeWatchlistIsDefault: undefined,
    })).toBe(false);
  });

  it('allows custom watchlists to drive the visible Market Watch rows', () => {
    expect(shouldUseWatchlistAsMarketWatchSource({
      activeWatchlistId: 'watchlist-1',
      activeWatchlistIsDefault: false,
    })).toBe(true);
  });
});
