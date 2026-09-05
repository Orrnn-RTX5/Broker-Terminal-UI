import { describe, expect, it, vi } from 'vitest';
import {
  arePriceReferencesCompatible,
  canDropPreloadedCandlesForLiveQuoteMismatch,
  createRenderedPriceReference,
  getChartPriceFromQuote,
  getMedianCandlePrice,
  getRenderedCandleReferencePrice,
  getTradeEntryPriceFromQuote,
  isPriceCompatibleWithCandles,
  isPriceCompatibleWithReference,
  isStructurallyValidPriceCandle,
  repairPriceCandle,
  normalizeCandlesToReference,
  normalizeCandlesToRenderedScale,
  resetLiveQuoteGuardState,
  sanitizePriceCandles,
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
    });
  });

  it('rejects zero, inverted, and implausible-wick candles', () => {
    expect(isStructurallyValidPriceCandle(candles[0])).toBe(true);
    expect(isStructurallyValidPriceCandle({ open: 0, high: 0, low: 0, close: 0 })).toBe(false);
    expect(isStructurallyValidPriceCandle({ open: 4680, high: 4670, low: 4660, close: 4685 })).toBe(false);
    expect(isStructurallyValidPriceCandle({ open: 4680, high: 280000, low: 4675, close: 4685 })).toBe(false);
  });

  it('seals missing high and low values for locally aggregated candles', () => {
    expect(repairPriceCandle({ open: 4680, high: 4670, low: 4660, close: 4685 })).toEqual({
      open: 4680,
      high: 4685,
      low: 4660,
      close: 4685,
    });
    expect(repairPriceCandle({ open: 4685, high: 4690, low: 4688, close: 4680 })).toEqual({
      open: 4685,
      high: 4690,
      low: 4680,
      close: 4680,
    });
    expect(repairPriceCandle({ open: 4680, high: 0, low: 0, close: 4685 })).toEqual({
      open: 4680,
      high: 4685,
      low: 4680,
      close: 4685,
    });
    expect(repairPriceCandle({ open: 0, high: 0, low: 0, close: 0 })).toBeNull();
  });

  it('does not invent missing backend high or low values during sanitization', () => {
    const invertedHigh = { time: 5, open: 4680, high: 4670, low: 4660, close: 4685, volume: 1 };
    expect(sanitizePriceCandles([candles[0], invertedHigh, candles[1]])).toEqual(candles);
  });

  it('removes an isolated incompatible price band without dropping valid XAU candles', () => {
    const corrupted = [
      candles[0],
      { time: 3, open: 0, high: 0, low: 0, close: 0, volume: 1 },
      { time: 4, open: 280000, high: 281000, low: 279000, close: 280500, volume: 1 },
      candles[1],
    ];

    expect(sanitizePriceCandles(corrupted)).toEqual(candles);
    expect(normalizeCandlesToReference(corrupted, 4686).candles).toEqual(candles);
  });

  it('keeps the GTA XAUUSD Friday history and Monday live quote on one price scale', () => {
    const fridayHistory = candles.map(candle => ({
      ...candle,
      open: 4521,
      high: 4529,
      low: 4512,
      close: 4521,
    }));

    expect(normalizeCandlesToReference(fridayHistory, 4438)).toMatchObject({
      status: 'compatible',
    });
  });

  it('rejects power-of-ten mismatches without mutating backend OHLC', () => {
    const scaled = candles.map(candle => ({
      ...candle,
      open: candle.open * 100,
      high: candle.high * 100,
      low: candle.low * 100,
      close: candle.close * 100,
    }));

    const result = normalizeCandlesToReference(scaled, 4686);

    expect(result).toEqual({ status: 'incompatible', candles: [] });
    expect(scaled[0].close).toBe(468500);
  });

  it('fails closed on mixed decimal bands without inventing a scale', () => {
    const mixedHistory = [
      { time: 1, open: 44.7, high: 44.8, low: 44.6, close: 44.75, volume: 10 },
      { time: 2, open: 4474, high: 4475, low: 4473, close: 4474.5, volume: 12 },
    ];

    const result = normalizeCandlesToReference(mixedHistory, null);

    expect(result).toEqual({ status: 'incompatible', candles: [] });
    expect(mixedHistory[0].close).toBe(44.75);
    expect(mixedHistory[1].close).toBe(4474.5);
  });

  it('preserves structurally valid long-range history spanning more than sixteen times', () => {
    const longRange = [
      { time: 1, open: 100, high: 110, low: 90, close: 105, volume: 1 },
      { time: 2, open: 350, high: 370, low: 330, close: 360, volume: 1 },
      { time: 3, open: 1100, high: 1200, low: 1000, close: 1150, volume: 1 },
      { time: 4, open: 3300, high: 3600, low: 3100, close: 3500, volume: 1 },
    ];

    expect(sanitizePriceCandles(longRange)).toEqual(longRange);
    expect(normalizeCandlesToReference(longRange, null).candles).toEqual(longRange);
  });

  it('rejects contaminated rows while preserving exact history in the externally verified price band', () => {
    const mixedScaleHistory = [
      {
        time: 1,
        open: 44.31405,
        high: 44.44585,
        low: 44.31405,
        close: 44.36435,
        volume: 10,
      },
      {
        time: 2,
        open: 4463.8,
        high: 4465.2,
        low: 4463.4,
        close: 4464.7,
        volume: 12,
      },
    ];

    const result = normalizeCandlesToReference(mixedScaleHistory, 4464.7);

    expect(result).toEqual({
      status: 'partial',
      discardedCount: 1,
      candles: [mixedScaleHistory[1]],
    });
    expect(mixedScaleHistory[0].close).toBe(44.36435);
    expect(mixedScaleHistory[1].close).toBe(4464.7);
  });

  it('filters interleaved wrong-band rows without losing later valid broker candles', () => {
    const interleaved = [
      { time: 1, open: 4440, high: 4442, low: 4438, close: 4441, volume: 10 },
      { time: 2, open: 44.4, high: 44.5, low: 44.3, close: 44.45, volume: 11 },
      { time: 3, open: 4435, high: 4438, low: 4434, close: 4437, volume: 12 },
      { time: 4, open: 44.3, high: 44.4, low: 44.2, close: 44.35, volume: 13 },
      { time: 5, open: 4390, high: 4395, low: 4388, close: 4392, volume: 14 },
    ];

    const result = normalizeCandlesToReference(interleaved, 4391.81);

    expect(result).toEqual({
      status: 'partial',
      discardedCount: 2,
      candles: [interleaved[0], interleaved[2], interleaved[4]],
    });
    expect(result.candles.map(candle => candle.close)).toEqual([4441, 4437, 4392]);
  });

  it('treats a delayed quote in another decimal band as incompatible', () => {
    expect(arePriceReferencesCompatible(468500, 4686)).toBe(false);
    expect(arePriceReferencesCompatible(4685, 4686)).toBe(true);
  });

  it('rejects older history in another price band against rendered candles', () => {
    const scaledOlderHistory = [
      { time: -1, open: 467000, high: 468000, low: 466500, close: 467500, volume: 8 },
      { time: 0, open: 467500, high: 468500, low: 467200, close: 468000, volume: 9 },
    ];

    const result = normalizeCandlesToRenderedScale(scaledOlderHistory, candles);

    expect(result).toEqual({ status: 'incompatible', candles: [] });
    expect(scaledOlderHistory[1].close).toBe(468000);
  });

  it('can use a rendered last close as the scale reference', () => {
    expect(getRenderedCandleReferencePrice([{ open: NaN, high: NaN, low: NaN, close: 4685 }])).toBe(4685);

    const result = normalizeCandlesToRenderedScale(
      [{ time: 0, open: 468000, high: 468000, low: 468000, close: 468000, volume: 1 }],
      [{ open: NaN, high: NaN, low: NaN, close: 4680 }],
    );

    expect(result).toEqual({ status: 'incompatible', candles: [] });
  });

  it('rejects wildly different non-scaled ranges such as BTC-like candles against XAU quotes', () => {
    const btcLikeCandles = [
      { time: 1, open: 63922, high: 63991, low: 63921, close: 63980, volume: 10 },
      { time: 2, open: 63980, high: 64010, low: 63950, close: 63970, volume: 12 },
    ];

    expect(getMedianCandlePrice(btcLikeCandles)).toBeGreaterThan(63000);
    expect(arePriceReferencesCompatible(63980, 4685)).toBe(false);
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
