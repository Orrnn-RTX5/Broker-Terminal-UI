import { describe, expect, it } from 'vitest';
import { readQuoteSessionRange } from './quoteSessionRange';

describe('readQuoteSessionRange', () => {
  it('reads the documented session Bid/Ask extremes', () => {
    expect(readQuoteSessionRange({
      bid: 1.0865,
      session: { high_bid: 1.0872, low_bid: 1.0854, high_ask: 1.0874, low_ask: '1.0856' },
    })).toEqual({ bidHigh: 1.0872, bidLow: 1.0854, askHigh: 1.0874, askLow: 1.0856 });
  });

  it('accepts flat adapter and MT5 native aliases, preferring the session object', () => {
    expect(readQuoteSessionRange({
      session: { high_bid: 10 },
      bid_high: 99,
      bidlow: 8,
      askHigh: 11,
      ask_low: 9,
    })).toEqual({ bidHigh: 10, bidLow: 8, askHigh: 11, askLow: 9 });
  });

  it('omits unsupported, zero and malformed sides instead of deriving them', () => {
    expect(readQuoteSessionRange({
      high: 12,
      session: { high_bid: 0, low_bid: '', high_ask: 'n/a', low_ask: -1 },
    })).toEqual({});
    expect(readQuoteSessionRange(null)).toEqual({});
    expect(readQuoteSessionRange({ session: [1, 2] })).toEqual({});
  });
});
