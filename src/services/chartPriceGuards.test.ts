import { describe, expect, it, vi } from 'vitest';
import {
  canDropPreloadedCandlesForLiveQuoteMismatch,
  createRenderedPriceReference,
  getChartPriceFromQuote,
  getMedianCandlePrice,
  getRenderedCandleReferencePrice,
  getReferenceScaleFactor,
  getTradeEntryPriceFromQuote,
  isPriceCompatibleWithCandles,
  isPriceCompatibleWithReference,
  normalizeCandlesToReference,
  normalizeCandlesToRenderedScale,
  resetLiveQuoteGuardState,
  scaleCandlePrices,
  updateLiveQuoteGuardState,
} from './chartPriceGuards';

const candles = [
  { time: 1, open: 4680, high: 4690, low: 4675, close: 4685, volume: 10 },
  { time: 2, open: 4685, high: 4695, low: 4682, close: 4692, volume: 12 },
];

describe('chart price guards', () => {
  it('uses bid as the chart-rendered live price', () => {
    expect(getChartPriceFromQuote({ bid: 65480.04, ask: 65484.53 })).toBe(65480.04);
  });

  it('falls back to ask or last when bid is unavailable', () => {
    expect(getChartPriceFromQuote({ bid: 65480.04 })).toBe(65480.04);
    expect(getChartPriceFromQuote({ ask: 65484.53 })).toBe(65484.53);
    expect(getChartPriceFromQuote({ last: 65482.12 })).toBe(65482.12);
    expect(getChartPriceFromQuote(null)).toBeNull();
  });

  it('uses executable side price for trade entry markers', () => {
    const quote = { bid: 65304.89, ask: 65316.89 };

    expect(getTradeEntryPriceFromQuote(quote, 'BUY')).toBe(65316.89);
    expect(getTradeEntryPriceFromQuote(quote, 'SELL')).toBe(65304.89);
  });

  it('falls back defensively for trade entry markers when one side is missing', () => {
    expect(getTradeEntryPriceFromQuote({ bid: 65304.89 }, 'BUY')).toBe(65304.89);
    expect(getTradeEntryPriceFromQuote({ ask: 65316.89 }, 'SELL')).toBe(65316.89);
    expect(getTradeEntryPriceFromQuote({ last: 65310.12 }, 'BUY')).toBe(65310.12);
    expect(getTradeEntryPriceFromQuote(null, 'SELL')).toBeNull();
  });

  it('accepts normal candle and quote drift', () => {
    expect(isPriceCompatibleWithCandles(4700, candles)).toBe(true);
    expect(normalizeCandlesToReference(candles, 4700)).toMatchObject({
      status: 'compatible',
      factor: 1,
    });
  });

  it('normalizes obvious power-of-ten scaled candles', () => {
    const scaled = candles.map(candle => ({
      ...candle,
      open: candle.open * 100,
      high: candle.high * 100,
      low: candle.low * 100,
      close: candle.close * 100,
    }));

    const result = normalizeCandlesToReference(scaled, 4686);

    expect(result.status).toBe('scaled');
    expect(result.factor).toBe(0.01);
    expect(result.candles[0].close).toBe(4685);
  });

  it('detects the same power-of-ten factor needed to normalize existing candles to a delayed quote', () => {
    const scaledExisting = candles.map(candle => scaleCandlePrices(candle, 100));
    const factor = getReferenceScaleFactor(getMedianCandlePrice(scaledExisting), 4686);

    expect(factor).toBe(0.01);
    expect(scaleCandlePrices(scaledExisting[0], factor ?? 1).close).toBe(4685);
  });

  it('normalizes older history against already rendered candles when no live quote exists', () => {
    const scaledOlderHistory = [
      { time: -1, open: 467000, high: 468000, low: 466500, close: 467500, volume: 8 },
      { time: 0, open: 467500, high: 468500, low: 467200, close: 468000, volume: 9 },
    ];

    const result = normalizeCandlesToRenderedScale(scaledOlderHistory, candles);

    expect(result.status).toBe('scaled');
    expect(result.factor).toBe(0.01);
    expect(result.candles[1].close).toBe(4680);
  });

  it('can use a rendered last close as the scale reference', () => {
    expect(getRenderedCandleReferencePrice([{ open: NaN, high: NaN, low: NaN, close: 4685 }])).toBe(4685);

    const result = normalizeCandlesToRenderedScale(
      [{ time: 0, open: 468000, high: 468000, low: 468000, close: 468000, volume: 1 }],
      [{ open: NaN, high: NaN, low: NaN, close: 4680 }],
    );

    expect(result.status).toBe('scaled');
    expect(result.candles[0].close).toBe(4680);
  });

  it('rejects wildly different non-scaled ranges such as BTC-like candles against XAU quotes', () => {
    const btcLikeCandles = [
      { time: 1, open: 63922, high: 63991, low: 63921, close: 63980, volume: 10 },
      { time: 2, open: 63980, high: 64010, low: 63950, close: 63970, volume: 12 },
    ];

    expect(getMedianCandlePrice(btcLikeCandles)).toBeGreaterThan(63000);
    expect(getReferenceScaleFactor(63980, 4685)).toBeNull();
    expect(isPriceCompatibleWithCandles(4685, btcLikeCandles)).toBe(false);
    expect(normalizeCandlesToReference(btcLikeCandles, 4685)).toMatchObject({
      status: 'incompatible',
      candles: [],
    });
  });

  it('matches median candle compatibility for normal data using a cached rendered reference', () => {
    const reference = createRenderedPriceReference(candles);

    expect(reference.price).toBe(getMedianCandlePrice(candles));
    expect(isPriceCompatibleWithReference(4700, reference)).toBe(isPriceCompatibleWithCandles(4700, candles));
    expect(isPriceCompatibleWithReference(64000, reference)).toBe(isPriceCompatibleWithCandles(64000, candles));
  });

  it('checks live quotes against a cached reference without sorting candles on every tick', () => {
    const reference = createRenderedPriceReference(candles);
    const sortSpy = vi.spyOn(Array.prototype, 'sort');
    sortSpy.mockImplementation(() => {
      throw new Error('live quote reference check must not sort candle arrays');
    });

    let compatible = false;
    let incompatible = true;
    try {
      compatible = isPriceCompatibleWithReference(4688, reference);
      incompatible = isPriceCompatibleWithReference(64000, reference);
    } finally {
      sortSpy.mockRestore();
    }

    expect(compatible).toBe(true);
    expect(incompatible).toBe(false);
  });

  it('does not drop candles after incompatible quotes once a quote was accepted', () => {
    const accepted = updateLiveQuoteGuardState(resetLiveQuoteGuardState(), true, 4685).state;

    const firstMismatch = updateLiveQuoteGuardState(accepted, false, 64000);
    const secondMismatch = updateLiveQuoteGuardState(firstMismatch.state, false, 64010);
    const thirdMismatch = updateLiveQuoteGuardState(secondMismatch.state, false, 64020);

    expect(thirdMismatch.state).toEqual({
      lastAcceptedQuote: 4685,
      incompatibleQuoteCount: 3,
    });
    expect(thirdMismatch.shouldDropCandles).toBe(false);
  });

  it('allows a reset data context to drop repeatedly incompatible preloaded candles', () => {
    const accepted = updateLiveQuoteGuardState(resetLiveQuoteGuardState(), true, 4685).state;
    const reset = resetLiveQuoteGuardState();

    expect(accepted.lastAcceptedQuote).toBe(4685);
    expect(reset).toEqual({
      lastAcceptedQuote: null,
      incompatibleQuoteCount: 0,
    });

    const firstMismatch = updateLiveQuoteGuardState(reset, false, 64000);
    const secondMismatch = updateLiveQuoteGuardState(firstMismatch.state, false, 64010);
    const thirdMismatch = updateLiveQuoteGuardState(secondMismatch.state, false, 64020);

    expect(thirdMismatch.state.incompatibleQuoteCount).toBe(3);
    expect(thirdMismatch.shouldDropCandles).toBe(true);
  });

  it('can suppress dropping candles while still tracking incompatible quotes', () => {
    const reset = resetLiveQuoteGuardState();

    const firstMismatch = updateLiveQuoteGuardState(reset, false, 64000, { allowDrop: false });
    const secondMismatch = updateLiveQuoteGuardState(firstMismatch.state, false, 64010, { allowDrop: false });
    const thirdMismatch = updateLiveQuoteGuardState(secondMismatch.state, false, 64020, { allowDrop: false });

    expect(thirdMismatch.state).toEqual({
      lastAcceptedQuote: null,
      incompatibleQuoteCount: 3,
    });
    expect(thirdMismatch.shouldDropCandles).toBe(false);
  });

  it('allows live quote mismatch drops only before meaningful history exists', () => {
    expect(canDropPreloadedCandlesForLiveQuoteMismatch({
      hasDisplayedHistory: false,
      protectedHistoryCount: 0,
      currentHistoryCount: 0,
    })).toBe(true);

    expect(canDropPreloadedCandlesForLiveQuoteMismatch({
      hasDisplayedHistory: false,
      protectedHistoryCount: 1,
      currentHistoryCount: 1,
    })).toBe(true);
  });

  it('blocks live quote mismatch drops once displayed or current history is meaningful', () => {
    expect(canDropPreloadedCandlesForLiveQuoteMismatch({
      hasDisplayedHistory: true,
      protectedHistoryCount: 0,
      currentHistoryCount: 0,
    })).toBe(false);

    expect(canDropPreloadedCandlesForLiveQuoteMismatch({
      hasDisplayedHistory: false,
      protectedHistoryCount: 2,
      currentHistoryCount: 0,
    })).toBe(false);

    expect(canDropPreloadedCandlesForLiveQuoteMismatch({
      hasDisplayedHistory: false,
      protectedHistoryCount: 0,
      currentHistoryCount: 2,
    })).toBe(false);
  });
});
