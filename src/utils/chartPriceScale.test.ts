import { describe, expect, it } from 'vitest';

import {
  buildChartSeriesPriceFormat,
  computeMinimumVisiblePriceSpan,
  formatChartAxisPrice,
  getInstrumentPriceDigits,
  getPricePointFromDigits,
  inferObservedPriceDigits,
  inferPriceDigitsFromValue,
  normalizePriceDigits,
  resolveEffectiveChartPriceDigits,
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
  it.each([
    [4417.245, 3, '4,417.245'],
    [4417.2, 2, '4,417.20'],
    [1.1637, 5, '1.16370'],
    [78216, 0, '78,216'],
  ] as const)('formats %s with %s broker digits', (price, digits, expected) => {
    expect(formatChartAxisPrice(price, digits)).toBe(expected);
  });

  it.each(digitCases)('preserves broker-provided $digits digits for $label', ({ symbol, digits }) => {
    expect(normalizePriceDigits(digits)).toBe(digits);
    expect(getInstrumentPriceDigits({ digits })).toBe(digits);
    expect(resolveSymbolPriceDigits(symbol, digits)).toBe(digits);
  });

  it('uses valid broker precision from spec sources', () => {
    expect(resolveSymbolPriceDigits('EURUSD', 0)).toBe(0);
    expect(resolveSymbolPriceDigits('XAUUSD', 5)).toBe(5);
    expect(resolveSymbolPriceDigits('UNKNOWN', '2')).toBe(2);
  });

  it('returns null when broker precision is missing or invalid (no symbol-name guessing)', () => {
    expect(resolveSymbolPriceDigits('XAUUSD')).toBeNull();
    expect(resolveSymbolPriceDigits('USDJPY', Number.NaN)).toBeNull();
    expect(resolveSymbolPriceDigits('EURUSD', -1)).toBeNull();
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

  it('infers observed decimal precision from candle OHLC and live quote values without symbol hardcoding', () => {
    expect(inferPriceDigitsFromValue(0.2068)).toBe(4);
    expect(inferPriceDigitsFromValue(1.027)).toBe(3);
    expect(inferPriceDigitsFromValue(2910)).toBe(0);
    expect(inferPriceDigitsFromValue(null)).toBeNull();

    const subCentCandles = [
      { open: 0.2058, high: 0.2062, low: 0.2055, close: 0.2060 },
      { open: 0.2060, high: 0.2074, low: 0.2059, close: 0.2068 },
    ];
    const observed = inferObservedPriceDigits(subCentCandles);
    expect(observed).toBe(4);
    // When catalog metadata reports coarser digits (e.g. 2) than the actual 4-decimal OHLC feed,
    // effective chart precision expands to 4 so PriceTickMarkBuilder does not step by 0.01 over a 0.0019 range.
    const effective = resolveEffectiveChartPriceDigits(2, observed);
    expect(effective).toBe(4);
    expect(getPricePointFromDigits(effective)).toBeCloseTo(0.0001, 12);
    expect(buildChartSeriesPriceFormat(effective, getPricePointFromDigits(effective))).toEqual({
      type: 'price',
      precision: 4,
      minMove: 0.0001,
    });
  });

  it('retains higher catalog precision when observed prices end in trailing zeros and guards null series format', () => {
    const roundCandles = [{ open: 1.1, high: 1.12, low: 1.09, close: 1.11 }];
    expect(resolveEffectiveChartPriceDigits(5, inferObservedPriceDigits(roundCandles))).toBe(5);
    expect(resolveEffectiveChartPriceDigits(null, inferObservedPriceDigits(roundCandles))).toBe(2);
    expect(resolveEffectiveChartPriceDigits(null, null)).toBeNull();
    expect(buildChartSeriesPriceFormat(null, Number.NaN)).toEqual({
      type: 'price',
      precision: 2,
      minMove: 0.01,
    });
  });

  it('infers sufficient decimal precision from narrow price spans even when prices end in trailing zeros', () => {
    const narrowTrailingZeroCandles = [
      { open: 0.201, high: 0.202, low: 0.201, close: 0.202 },
    ];
    expect(inferObservedPriceDigits(narrowTrailingZeroCandles)).toBe(4);
    expect(resolveEffectiveChartPriceDigits(2, inferObservedPriceDigits(narrowTrailingZeroCandles))).toBe(4);
  });

  it('does not inflate observed price digits on 1-point or 2-point live ticks and forming candles', () => {
    // 2-decimal instrument with 1-point and 2-point spans (including IEEE-754 subtraction noise)
    expect(inferObservedPriceDigits(
      [{ open: 2750.10, high: 2750.11, low: 2750.10, close: 2750.11 }],
    )).toBe(2);
    expect(inferObservedPriceDigits(
      [{ open: 2750.10, high: 2750.12, low: 2750.10, close: 2750.12 }],
    )).toBe(2);
    expect(inferObservedPriceDigits(undefined, [2750.10, 2750.11, 2750.10, 2750.11])).toBe(2);
    expect(inferObservedPriceDigits(undefined, [2750.10, 2750.12, 2750.10, 2750.12])).toBe(2);

    // 5-decimal FX pair with a 1-point spread
    expect(inferObservedPriceDigits(
      [{ open: 1.08500, high: 1.08501, low: 1.08500, close: 1.08501 }],
    )).toBe(5);
    expect(inferObservedPriceDigits(undefined, [1.08500, 1.08501, 1.08501])).toBe(5);

    // 4-decimal sub-unit instrument with a 1-point spread stays at 4 digits
    expect(inferObservedPriceDigits(
      [{ open: 0.2058, high: 0.2059, low: 0.2058, close: 0.2059 }],
    )).toBe(4);
  });
});

describe('maximum price-scale zoom', () => {
  it.each(digitCases)(
    'derives a geometry-aware minimum span for $label with one point per label interval',
    ({ point }) => {
      // 600px pane with 5% top and 28% bottom margins leaves 402px.
      // Lightweight Charts' nominal label height is 30px here; the 32px
      // boundary-safe spacing leaves twelve one-point intervals visible.
      const minimumSpan = computeMinimumVisiblePriceSpan({
        point,
        paneHeight: 600,
        fontSize: 12,
        topMargin: 0.05,
        bottomMargin: 0.28,
      });

      expect(minimumSpan / point).toBeCloseTo(12, 12);
    },
  );

  it('falls back to one point when pane geometry is unavailable', () => {
    expect(computeMinimumVisiblePriceSpan({
      point: 0.01,
      paneHeight: 0,
      fontSize: 12,
    })).toBe(0.01);
  });

  it('keeps the common 460px Gold pane below the two-point tick boundary', () => {
    expect(computeMinimumVisiblePriceSpan({
      point: 0.01,
      paneHeight: 460,
      fontSize: 11,
      topMargin: 0.05,
      bottomMargin: 0.28,
    })).toBeCloseTo(0.09, 12);
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
