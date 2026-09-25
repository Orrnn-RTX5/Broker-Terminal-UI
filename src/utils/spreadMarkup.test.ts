import { describe, expect, it } from 'vitest';
import {
  EMPTY_SPREAD_MARKUP_MAP,
  applySpreadMarkupFromMap,
  applySpreadMarkupToBookLevels,
  applySpreadMarkupToQuote,
  areSpreadMarkupMapsEqual,
  buildSpreadMarkupMap,
  getQuoteBidMarkupOffset,
  getRawQuoteSides,
  getSpreadMarkupOffset,
  readSpreadMarkupPoints,
  resolvePositionClosePrice,
  resolveSpreadMarkupEntry,
  roundPriceToDigits,
} from './spreadMarkup';

const EURUSD = { points: 5, tickSize: 0.00001, digits: 5 };

describe('readSpreadMarkupPoints', () => {
  it('reads the backend spread_markup integer (or camelCase alias)', () => {
    expect(readSpreadMarkupPoints({ spread_markup: 7 })).toBe(7);
    expect(readSpreadMarkupPoints({ spreadMarkup: '3' })).toBe(3);
    expect(readSpreadMarkupPoints({ spread_markup: 0 })).toBe(0);
  });

  it('treats missing as undefined and invalid/negative as zero', () => {
    expect(readSpreadMarkupPoints({ symbol: 'EURUSD' })).toBeUndefined();
    expect(readSpreadMarkupPoints({ spread_markup: null })).toBeUndefined();
    expect(readSpreadMarkupPoints({ spread_markup: -4 })).toBe(0);
    expect(readSpreadMarkupPoints({ spread_markup: 'abc' })).toBe(0);
    expect(readSpreadMarkupPoints(null)).toBeUndefined();
  });
});

describe('buildSpreadMarkupMap', () => {
  it('maps symbols with a positive markup using the instrument tick size', () => {
    const map = buildSpreadMarkupMap([
      { symbol: 'eurusd', spreadMarkup: 5, tickSize: 0.00001, digits: 5 },
      { symbol: 'US30', spreadMarkup: 2, tickSize: 0.5, digits: 1 },
      { symbol: 'GBPUSD', spreadMarkup: 0, tickSize: 0.00001, digits: 5 },
      { symbol: 'USDJPY' },
    ]);
    expect(map.get('EURUSD')).toEqual(EURUSD);
    expect(map.get('US30')).toEqual({ points: 2, tickSize: 0.5, digits: 1 });
    expect(map.has('GBPUSD')).toBe(false);
    expect(map.has('USDJPY')).toBe(false);
  });

  it('falls back to 10^-digits when no tick size exists, and derives digits from tick size', () => {
    expect(resolveSpreadMarkupEntry({ spreadMarkup: 4, digits: 3 })).toEqual({ points: 4, tickSize: 0.001, digits: 3 });
    expect(resolveSpreadMarkupEntry({ spreadMarkup: 4, tickSize: 0.01 })).toEqual({ points: 4, tickSize: 0.01, digits: 2 });
    expect(resolveSpreadMarkupEntry({ spreadMarkup: 4 })).toBeNull();
  });

  it('returns the shared empty map when nothing is marked up', () => {
    expect(buildSpreadMarkupMap([{ symbol: 'EURUSD', spreadMarkup: 0, digits: 5 }])).toBe(EMPTY_SPREAD_MARKUP_MAP);
  });

  it('compares maps by content', () => {
    const left = buildSpreadMarkupMap([{ symbol: 'EURUSD', spreadMarkup: 5, digits: 5 }]);
    const same = buildSpreadMarkupMap([{ symbol: 'EURUSD', spreadMarkup: 5, digits: 5 }]);
    const changed = buildSpreadMarkupMap([{ symbol: 'EURUSD', spreadMarkup: 6, digits: 5 }]);
    expect(areSpreadMarkupMapsEqual(left, same)).toBe(true);
    expect(areSpreadMarkupMapsEqual(left, changed)).toBe(false);
    expect(areSpreadMarkupMapsEqual(left, EMPTY_SPREAD_MARKUP_MAP)).toBe(false);
  });
});

describe('applySpreadMarkupToQuote', () => {
  it('widens bid down and ask up by markup x tick size, rounded to digits', () => {
    const quote = applySpreadMarkupToQuote({ symbol: 'EURUSD', bid: 1.1, ask: 1.10012, spread: 0.00012 }, EURUSD);
    expect(quote.bid).toBe(1.09995);
    expect(quote.ask).toBe(1.10017);
    expect(quote.spread).toBe(0.00022);
    expect(quote.rawBid).toBe(1.1);
    expect(quote.rawAsk).toBe(1.10012);
    expect(quote.spreadMarkup).toBe(5);
  });

  it('avoids float noise for prices that are not exactly representable', () => {
    const quote = applySpreadMarkupToQuote({ bid: 0.3, ask: 0.30003 }, { points: 1, tickSize: 0.00001, digits: 5 });
    expect(quote.bid).toBe(0.29999);
    expect(quote.ask).toBe(0.30004);
    expect(getSpreadMarkupOffset({ points: 3, tickSize: 0.1, digits: 1 })).toBe(0.3);
    expect(roundPriceToDigits(1.005 - 0.00001, 5)).toBe(1.00499);
  });

  it('is idempotent: re-applying never compounds and a new markup recomputes from raw', () => {
    const once = applySpreadMarkupToQuote({ bid: 1.1, ask: 1.10012 }, EURUSD);
    const twice = applySpreadMarkupToQuote(once, EURUSD);
    expect(twice).toEqual(once);

    const repriced = applySpreadMarkupToQuote(once, { ...EURUSD, points: 10 });
    expect(repriced.bid).toBe(1.0999);
    expect(repriced.ask).toBe(1.10022);
    expect(repriced.rawBid).toBe(1.1);
  });

  it('leaves quotes unchanged without markup and restores raw sides when markup is removed', () => {
    const raw = { bid: 1.1, ask: 1.10012, spread: 0.00012 };
    expect(applySpreadMarkupToQuote(raw, undefined)).toBe(raw);
    expect(applySpreadMarkupToQuote(raw, { ...EURUSD, points: 0 })).toBe(raw);

    const widened = applySpreadMarkupToQuote(raw, EURUSD);
    const restored = applySpreadMarkupToQuote(widened, undefined);
    expect(restored.bid).toBe(1.1);
    expect(restored.ask).toBe(1.10012);
    expect(restored).not.toHaveProperty('rawBid');
    expect(restored).not.toHaveProperty('spreadMarkup');
  });

  it('only moves the sides that carry a price', () => {
    const quote = applySpreadMarkupToQuote({ bid: 0, ask: 1.2 }, EURUSD);
    expect(quote.bid).toBe(0);
    expect(quote.ask).toBe(1.20005);
    expect(applySpreadMarkupToQuote({ bid: 0, ask: 0 }, EURUSD)).toEqual({ bid: 0, ask: 0 });
  });

  it('looks the markup up by normalized symbol', () => {
    const map = buildSpreadMarkupMap([{ symbol: 'EURUSD', spreadMarkup: 5, tickSize: 0.00001, digits: 5 }]);
    expect(applySpreadMarkupFromMap(' eurusd ', { bid: 1.1, ask: 1.1001 }, map).bid).toBe(1.09995);
    const other = { bid: 1.3, ask: 1.3001 };
    expect(applySpreadMarkupFromMap('GBPUSD', other, map)).toBe(other);
  });
});

describe('raw quote helpers for raw-bid chart candles', () => {
  it('returns the feed sides of a widened quote and its bid offset', () => {
    const widened = applySpreadMarkupToQuote({ bid: 1.1, ask: 1.10012 }, EURUSD);
    expect(getRawQuoteSides(widened)).toMatchObject({ bid: 1.1, ask: 1.10012 });
    expect(getQuoteBidMarkupOffset(widened)).toBe(0.00005);
  });

  it('passes raw quotes and missing quotes through', () => {
    const raw = { bid: 1.1, ask: 1.1001 };
    expect(getRawQuoteSides(raw)).toBe(raw);
    expect(getRawQuoteSides(undefined)).toBeUndefined();
    expect(getQuoteBidMarkupOffset(raw)).toBe(0);
    expect(getQuoteBidMarkupOffset(null)).toBe(0);
  });
});

describe('applySpreadMarkupToBookLevels', () => {
  it('moves bid levels down and ask levels up', () => {
    const bids = [{ price: 1.1, volume: 1, total: 1 }, { price: 1.09999, volume: 2, total: 3 }];
    const asks = [{ price: 1.10012, volume: 1, total: 1 }];
    expect(applySpreadMarkupToBookLevels(bids, 'bid', EURUSD).map((level) => level.price)).toEqual([1.09995, 1.09994]);
    expect(applySpreadMarkupToBookLevels(asks, 'ask', EURUSD)[0]).toEqual({ price: 1.10017, volume: 1, total: 1 });
    expect(applySpreadMarkupToBookLevels(bids, 'bid', undefined)).toBe(bids);
  });
});

describe('resolvePositionClosePrice', () => {
  it('closes BUY at bid and SELL at ask of the effective quote', () => {
    const quote = applySpreadMarkupToQuote({ bid: 1.1, ask: 1.10012 }, EURUSD);
    expect(resolvePositionClosePrice('BUY', quote)).toBe(1.09995);
    expect(resolvePositionClosePrice('sell', quote)).toBe(1.10017);
  });

  it('falls back to last and then the other side', () => {
    expect(resolvePositionClosePrice('BUY', { bid: 0, last: 1.2, ask: 1.3 })).toBe(1.2);
    expect(resolvePositionClosePrice('SELL', { ask: 0, bid: 1.1 })).toBe(1.1);
    expect(resolvePositionClosePrice('BUY', { bid: 0, ask: 0 })).toBeNull();
    expect(resolvePositionClosePrice('BUY', undefined)).toBeNull();
  });
});
