import { getSymbolDigits } from './symbolUtils';

const MAX_SUPPORTED_PRICE_DIGITS = 12;

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

export const getInstrumentPriceDigits = (instrument: unknown): number | undefined => {
  if (!instrument || typeof instrument !== 'object') return undefined;
  const digits = normalizePriceDigits((instrument as Record<string, unknown>).digits);
  return digits ?? undefined;
};

export const resolveSymbolPriceDigits = (symbol: string, brokerDigits?: unknown): number => (
  normalizePriceDigits(brokerDigits) ?? getSymbolDigits(symbol)
);

export const getPricePointFromDigits = (digits: number): number => (
  Math.pow(10, -(normalizePriceDigits(digits) ?? getSymbolDigits('')))
);

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
