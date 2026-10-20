import { readRegisteredSymbolPriceSpec } from '../services/dailyChangePriceModeRegistry';
import { getPipExponentFromDigits, resolveSpecDigits } from './symbolUtils';

export type SpreadDisplayUnit = 'pips' | 'price';

export interface SpreadDisplay {
  raw: number;
  value: number;
  unit: SpreadDisplayUnit;
  formatted: string;
}

const toFiniteNumber = (value: unknown): number | null => {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
};

const trimTrailingZeros = (value: string): string =>
  value.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');

export const resolveRawSpread = (spread: unknown, bid?: unknown, ask?: unknown): number => {
  const direct = toFiniteNumber(spread);
  const bidNumber = toFiniteNumber(bid);
  const askNumber = toFiniteNumber(ask);
  const derived = bidNumber !== null && askNumber !== null ? Math.max(0, askNumber - bidNumber) : null;

  if (direct !== null && direct > 0) return direct;
  if (derived !== null && derived > 0) return derived;
  if (direct !== null) return Math.max(0, direct);
  return 0;
};

/**
 * Broker precision for spread display: the registered broker catalog first,
 * then the caller's quote/tick digits. Null when no spec digits are known;
 * never guessed from the symbol name.
 */
export const resolveSpreadDigits = (symbol: unknown, digits?: unknown): number | null =>
  resolveSpecDigits(readRegisteredSymbolPriceSpec(symbol).digits, digits);

/**
 * Pip multiplier derived from broker digits via the terminal's single pip
 * rule (getPipExponentFromDigits): 5 -> x10000, 3 -> x100, 2 -> x100,
 * 4 -> x10000. Callers pass resolved spec digits.
 */
export const getSpreadPipFactor = (digits: number): number =>
  Math.pow(10, getPipExponentFromDigits(digits) ?? 0);

const formatPipSpread = (value: number): string => {
  if (value >= 10) return Math.round(value).toString();
  if (value >= 1) return trimTrailingZeros(value.toFixed(1));
  return trimTrailingZeros(value.toFixed(2));
};

const formatPriceSpread = (value: number): string => {
  if (value >= 0.01) return value.toFixed(2);
  if (value >= 0.00001) return trimTrailingZeros(value.toFixed(5));
  return trimTrailingZeros(value.toPrecision(2));
};

/**
 * Spread display from broker spec data only. With known digits (catalog or
 * the caller's tick/quote digits) the spread is shown in pips; without them
 * the raw price spread is shown.
 */
export const getSpreadDisplay = (
  symbol: unknown,
  spread: unknown,
  bid?: unknown,
  ask?: unknown,
  digits?: unknown,
): SpreadDisplay => {
  const raw = resolveRawSpread(spread, bid, ask);
  const specDigits = resolveSpreadDigits(symbol, digits);

  if (raw <= 0) {
    return {
      raw,
      value: 0,
      unit: specDigits === null ? 'price' : 'pips',
      formatted: '0',
    };
  }

  if (specDigits !== null) {
    const value = raw * getSpreadPipFactor(specDigits);
    return {
      raw,
      value,
      unit: 'pips',
      formatted: formatPipSpread(value),
    };
  }

  return {
    raw,
    value: raw,
    unit: 'price',
    formatted: formatPriceSpread(raw),
  };
};

export const formatSpreadDisplay = (
  symbol: unknown,
  spread: unknown,
  bid?: unknown,
  ask?: unknown,
  digits?: unknown,
): string => getSpreadDisplay(symbol, spread, bid, ask, digits).formatted;

export const formatSpreadDisplayWithUnit = (
  symbol: unknown,
  spread: unknown,
  bid?: unknown,
  ask?: unknown,
  digits?: unknown,
): string => {
  const display = getSpreadDisplay(symbol, spread, bid, ask, digits);
  if (display.formatted === '-') return display.formatted;
  return display.unit === 'pips' ? `${display.formatted} pips` : display.formatted;
};
