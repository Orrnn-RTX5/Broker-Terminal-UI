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

export const inferPriceDigitsFromValue = (value: unknown): number | null => {
  const num = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(num) || num <= 0) return null;
  const fixed = Math.abs(num).toFixed(MAX_OBSERVED_PRICE_DIGITS);
  const dotIndex = fixed.indexOf('.');
  if (dotIndex < 0) return 0;
  const trimmed = fixed.slice(dotIndex + 1).replace(/0+$/, '');
  return trimmed.length;
};

export const inferObservedPriceDigits = (
  candles?: ReadonlyArray<{ open?: unknown; high?: unknown; low?: unknown; close?: unknown }> | null,
  livePrices?: readonly unknown[],
): number | null => {
  let maxDigits: number | null = null;
  const consider = (value: unknown) => {
    const digits = inferPriceDigitsFromValue(value);
    if (digits !== null && (maxDigits === null || digits > maxDigits)) {
      maxDigits = digits;
    }
  };

  if (Array.isArray(candles) && candles.length > 0) {
    const startIndex = Math.max(0, candles.length - 128);
    for (let index = startIndex; index < candles.length; index += 1) {
      const candle = candles[index];
      if (!candle) continue;
      consider(candle.open);
      consider(candle.high);
      consider(candle.low);
      consider(candle.close);
    }
  }

  if (Array.isArray(livePrices)) {
    for (let index = 0; index < livePrices.length; index += 1) {
      consider(livePrices[index]);
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
    return Math.max(resolvedSpec, resolvedObserved);
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
  const digits = normalizePriceDigits((instrument as Record<string, unknown>).digits);
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
