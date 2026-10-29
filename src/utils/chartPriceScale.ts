import { resolveSpecDigits } from './symbolUtils';

const MAX_SUPPORTED_PRICE_DIGITS = 12;
const MAX_OBSERVED_PRICE_DIGITS = 8;

// Lightweight Charts' nominal label height is ceil(fontSize * 2.5), but its
// margin extension and integer-coordinate math need a little more room at the
// boundary. A 32px floor reliably selects one broker point instead of the next
// 2/5-point tick step at maximum zoom.
export const PRICE_SCALE_TICK_DENSITY = 2.5;
export const PRICE_SCALE_MIN_TICK_SPACING_PX = 32;

export const normalizePriceDigits = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_SUPPORTED_PRICE_DIGITS) return null;
  return parsed;
};

const inspectPriceDigitsFromValue = (
  value: unknown,
): { digits: number; endsWithFive: boolean; num: number } | null => {
  const num = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(num) || num <= 0) return null;
  const fixed = Math.abs(num).toFixed(MAX_OBSERVED_PRICE_DIGITS);
  const dotIndex = fixed.indexOf('.');
  if (dotIndex < 0) return { digits: 0, endsWithFive: false, num };
  const trimmed = fixed.slice(dotIndex + 1).replace(/0+$/, '');
  return {
    digits: trimmed.length,
    endsWithFive: trimmed.length > 0 && trimmed.charCodeAt(trimmed.length - 1) === 53,
    num,
  };
};

export const inferPriceDigitsFromValue = (value: unknown): number | null => (
  inspectPriceDigitsFromValue(value)?.digits ?? null
);

export const inferObservedPriceDigits = (
  candles?: ReadonlyArray<{ open?: unknown; high?: unknown; low?: unknown; close?: unknown }> | null,
  livePrices?: readonly unknown[],
): number | null => {
  let maxDigits: number | null = null;
  let minCandlePrice = Number.POSITIVE_INFINITY;
  let maxCandlePrice = Number.NEGATIVE_INFINITY;
  const digitCounts = new Map<number, { count: number; allEndWithFive: boolean }>();
  let totalSamples = 0;

  const consider = (value: unknown, isCandleValue = false) => {
    const inspected = inspectPriceDigitsFromValue(value);
    if (!inspected) return;
    const { digits, endsWithFive, num } = inspected;
    if (isCandleValue) {
      if (num < minCandlePrice) minCandlePrice = num;
      if (num > maxCandlePrice) maxCandlePrice = num;
    }
    totalSamples += 1;
    const existing = digitCounts.get(digits);
    if (existing) {
      existing.count += 1;
      existing.allEndWithFive = existing.allEndWithFive && endsWithFive;
    } else {
      digitCounts.set(digits, { count: 1, allEndWithFive: endsWithFive });
    }
    if (maxDigits === null || digits > maxDigits) {
      maxDigits = digits;
    }
  };

  if (Array.isArray(candles) && candles.length > 0) {
    const startIndex = Math.max(0, candles.length - 128);
    for (let index = startIndex; index < candles.length; index += 1) {
      const candle = candles[index];
      if (!candle) continue;
      consider(candle.open, true);
      consider(candle.high, true);
      consider(candle.low, true);
      consider(candle.close, true);
    }
  }

  if (Array.isArray(livePrices)) {
    for (let index = 0; index < livePrices.length; index += 1) {
      consider(livePrices[index], false);
    }
  }

  if (maxDigits !== null && maxDigits > 0 && totalSamples >= 2) {
    const topBucket = digitCounts.get(maxDigits);
    let secondMaxDigits: number | null = null;
    for (const candidateDigits of digitCounts.keys()) {
      if (candidateDigits < maxDigits && (secondMaxDigits === null || candidateDigits > secondMaxDigits)) {
        secondMaxDigits = candidateDigits;
      }
    }
    if (
      topBucket
      && topBucket.allEndWithFive
      && secondMaxDigits !== null
      && maxDigits === secondMaxDigits + 1
      && !(maxCandlePrice < 1 && maxDigits <= 4)
      && topBucket.count * 2 <= totalSamples
    ) {
      maxDigits = secondMaxDigits;
    }
  }

  const priceSpan = Number((maxCandlePrice - minCandlePrice).toFixed(MAX_OBSERVED_PRICE_DIGITS));
  if (Number.isFinite(priceSpan) && priceSpan > 0 && maxCandlePrice < 1) {
    const spanDigits = Math.min(
      4,
      Math.max(0, Math.ceil(-Math.log10(priceSpan / 10))),
    );
    if (maxDigits === null || spanDigits > maxDigits) {
      maxDigits = spanDigits;
    }
  }

  return maxDigits;
};

export const resolveEffectiveChartPriceDigits = (
  specDigits: unknown,
  observedDigits?: unknown,
): number | null => {
  const resolvedSpec = resolveSpecDigits(specDigits);
  const resolvedObserved = resolveSpecDigits(observedDigits);
  if (resolvedSpec !== null && resolvedObserved !== null) {
    if (resolvedObserved > resolvedSpec && resolvedSpec <= 2 && resolvedObserved >= 4) {
      return resolvedObserved;
    }
    return resolvedSpec;
  }
  return resolvedSpec ?? resolvedObserved;
};

export const buildChartSeriesPriceFormat = (
  digits: unknown,
  point?: unknown,
): { type: 'price'; precision: number; minMove: number } => {
  const resolvedDigits = normalizePriceDigits(digits) ?? 2;
  const explicitPoint = typeof point === 'number' && Number.isFinite(point) && point > 0
    ? point
    : Math.pow(10, -resolvedDigits);
  return {
    type: 'price',
    precision: resolvedDigits,
    minMove: explicitPoint,
  };
};

export const getInstrumentPriceDigits = (instrument: unknown): number | undefined => {
  if (!instrument || typeof instrument !== 'object') return undefined;
  const record = instrument as Record<string, unknown>;
  const brokerSpecification = record.brokerSpecification && typeof record.brokerSpecification === 'object'
    ? (record.brokerSpecification as Record<string, unknown>)
    : undefined;
  const specification = record.specification && typeof record.specification === 'object'
    ? (record.specification as Record<string, unknown>)
    : undefined;
  const digits = resolveSpecDigits(
    record.digits,
    brokerSpecification?.digits,
    specification?.digits,
  );
  return digits ?? undefined;
};

/**
 * Spec-first broker digits for the price scale. The symbol parameter is
 * retained for call-site compatibility during migration and is deliberately
 * ignored: no precision is ever guessed from the symbol name. Returns null
 * when no broker digits are in scope; callers render raw (String(value))
 * when null.
 */
export const resolveSymbolPriceDigits = (symbol: string, brokerDigits?: unknown): number | null => {
  void symbol;
  return resolveSpecDigits(brokerDigits);
};

const axisPriceFormatters = new Map<number, Intl.NumberFormat>();

/** Group large axis values without losing broker precision or trailing zeros. Unknown precision renders raw (never a guessed fallback). */
export const formatChartAxisPrice = (price: number, digits: unknown): string => {
  const precision = normalizePriceDigits(digits);
  if (precision === null) return String(price);
  let formatter = axisPriceFormatters.get(precision);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
      useGrouping: true,
    });
    axisPriceFormatters.set(precision, formatter);
  }
  return formatter.format(price);
};

/**
 * One symbol point (10^-digits) from broker digits. Returns NaN when no spec
 * digits are in scope — NaN marks absent precision without inventing a
 * fallback constant or guessing from a symbol name.
 */
export const getPricePointFromDigits = (digits: number | null | undefined): number => {
  const resolved = resolveSpecDigits(digits);
  if (resolved === null) return NaN;
  return Math.pow(10, -resolved);
};

export interface MinimumVisiblePriceSpanInput {
  point: number;
  paneHeight: number;
  fontSize: number;
  topMargin?: number;
  bottomMargin?: number;
}

/**
 * Smallest custom visible range that still fills the price scale with labels
 * separated by exactly one symbol point (XAU 2 digits: 4000.10, 4000.11, ...).
 */
export const computeMinimumVisiblePriceSpan = ({
  point,
  paneHeight,
  fontSize,
  topMargin = 0,
  bottomMargin = 0,
}: MinimumVisiblePriceSpanInput): number => {
  if (!Number.isFinite(point) || point <= 0) return 0;
  if (!Number.isFinite(paneHeight) || paneHeight <= 0 || !Number.isFinite(fontSize) || fontSize <= 0) {
    return point;
  }

  const safeTopMargin = Number.isFinite(topMargin) ? Math.max(0, Math.min(1, topMargin)) : 0;
  const safeBottomMargin = Number.isFinite(bottomMargin) ? Math.max(0, Math.min(1, bottomMargin)) : 0;
  const usableRatio = Math.max(0, 1 - safeTopMargin - safeBottomMargin);
  const usableHeight = paneHeight * usableRatio;
  const tickMarkHeight = Math.max(
    PRICE_SCALE_MIN_TICK_SPACING_PX,
    Math.ceil(fontSize * PRICE_SCALE_TICK_DENSITY),
  );
  const visiblePointIntervals = Math.max(1, Math.floor(usableHeight / tickMarkHeight));

  return point * visiblePointIntervals;
};
