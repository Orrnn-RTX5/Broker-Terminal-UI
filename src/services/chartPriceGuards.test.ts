import { describe, expect, it } from 'vitest';
import {
  getMedianCandlePrice,
  getRenderedCandleReferencePrice,
  getReferenceScaleFactor,
  isPriceCompatibleWithCandles,
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
});
