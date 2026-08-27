import { describe, expect, it } from 'vitest';

import {
  computeMinimumVisiblePriceSpan,
  getInstrumentPriceDigits,
  getPricePointFromDigits,
  normalizePriceDigits,
  resolveSymbolPriceDigits,
} from './chartPriceScale';
import { computePriceAxisDragRange } from './priceAxisDragZoom';

const digitCases = [
  { label: 'integer', symbol: 'SYNTHINDEX', digits: 0, point: 1, center: 4000 },
  { label: 'gold', symbol: 'XAUUSD', digits: 2, point: 0.01, center: 4000.1 },
  { label: 'yen FX', symbol: 'USDJPY', digits: 3, point: 0.001, center: 150.123 },
  { label: 'standard FX', symbol: 'EURUSD', digits: 5, point: 0.00001, center: 1.10123 },
] as const;

describe('chart price-scale precision', () => {
  it.each(digitCases)('preserves broker-provided $digits digits for $label', ({ symbol, digits }) => {
    expect(normalizePriceDigits(digits)).toBe(digits);
    expect(getInstrumentPriceDigits({ digits })).toBe(digits);
    expect(resolveSymbolPriceDigits(symbol, digits)).toBe(digits);
  });

  it('uses valid broker precision before the symbol-name fallback', () => {
    expect(resolveSymbolPriceDigits('EURUSD', 0)).toBe(0);
    expect(resolveSymbolPriceDigits('XAUUSD', 5)).toBe(5);
    expect(resolveSymbolPriceDigits('UNKNOWN', '2')).toBe(2);
  });

  it('falls back to the symbol precision when broker precision is missing or invalid', () => {
    expect(resolveSymbolPriceDigits('XAUUSD')).toBe(2);
    expect(resolveSymbolPriceDigits('USDJPY', Number.NaN)).toBe(3);
    expect(resolveSymbolPriceDigits('EURUSD', -1)).toBe(5);
    expect(getInstrumentPriceDigits({ digits: 2.5 })).toBeUndefined();
    expect(getInstrumentPriceDigits(null)).toBeUndefined();
  });

  it.each([null, '', '   ', false, true, {}, []])(
    'does not mistake empty or non-numeric metadata %j for a valid digit count',
    (value) => {
      expect(normalizePriceDigits(value)).toBeNull();
    },
  );

  it.each(digitCases)('derives one $label point from $digits digits', ({ digits, point }) => {
    expect(getPricePointFromDigits(digits)).toBeCloseTo(point, 12);
  });
});

describe('maximum price-scale zoom', () => {
  it.each(digitCases)(
    'derives a geometry-aware minimum span for $label with one point per label interval',
    ({ point }) => {
      // 600px pane with 5% top and 28% bottom margins leaves 402px.
      // At a 12px font, Lightweight Charts reserves ceil(12 * 2.5) = 30px
      // per tick, so thirteen one-point intervals remain visible.
      const minimumSpan = computeMinimumVisiblePriceSpan({
        point,
        paneHeight: 600,
        fontSize: 12,
        topMargin: 0.05,
        bottomMargin: 0.28,
      });

      expect(minimumSpan / point).toBeCloseTo(13, 12);
    },
  );

  it('falls back to one point when pane geometry is unavailable', () => {
    expect(computeMinimumVisiblePriceSpan({
      point: 0.01,
      paneHeight: 0,
      fontSize: 12,
    })).toBe(0.01);
  });

  it.each(digitCases)(
    'clamps an extreme $label axis zoom to the geometry-derived span',
    ({ point, center }) => {
      const minimumSpan = computeMinimumVisiblePriceSpan({
        point,
        paneHeight: 300,
        fontSize: 12,
      });
      const startingSpan = minimumSpan * 10;
      const zoomed = computePriceAxisDragRange({
        startFrom: center - startingSpan / 2,
        startTo: center + startingSpan / 2,
        dragDeltaY: -100_000,
        minSpan: minimumSpan,
      });

      expect(zoomed).not.toBeNull();
      expect((zoomed!.to - zoomed!.from) / minimumSpan).toBeCloseTo(1, 7);
      expect((zoomed!.from + zoomed!.to) / 2).toBeCloseTo(center, 7);

      const beyondMaximum = computePriceAxisDragRange({
        startFrom: zoomed!.from,
        startTo: zoomed!.to,
        dragDeltaY: -1_000,
        minSpan: minimumSpan,
      });
      expect(beyondMaximum).not.toBeNull();
      expect((beyondMaximum!.to - beyondMaximum!.from) / minimumSpan).toBeCloseTo(1, 7);
    },
  );
});
