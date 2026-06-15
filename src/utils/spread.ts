export type SpreadDisplayUnit = 'pips' | 'price';

export interface SpreadDisplay {
  raw: number;
  value: number;
  unit: SpreadDisplayUnit;
  formatted: string;
}

const FOREX_CURRENCIES = new Set([
  'AUD',
  'CAD',
  'CHF',
  'EUR',
  'GBP',
  'JPY',
  'NZD',
  'USD',
]);

const METAL_PREFIXES = ['XAU', 'XAG', 'XPT', 'XPD'];

const normalizeSymbolForSpread = (symbol: unknown): string =>
  String(symbol ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

const toFiniteNumber = (value: unknown): number | null => {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
};

const trimTrailingZeros = (value: string): string =>
  value.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');

export const isForexPair = (symbol: unknown): boolean => {
  const normalized = normalizeSymbolForSpread(symbol);
  if (normalized.length < 6) return false;

  const base = normalized.slice(0, 3);
  const quote = normalized.slice(3, 6);
  return FOREX_CURRENCIES.has(base) && FOREX_CURRENCIES.has(quote);
};

export const isMetalSymbol = (symbol: unknown): boolean => {
  const normalized = normalizeSymbolForSpread(symbol);
  return METAL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};

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

const getForexPipFactor = (symbol: unknown): number => {
  const normalized = normalizeSymbolForSpread(symbol);
  const quote = normalized.slice(3, 6);
  return quote === 'JPY' ? 100 : 10000;
};

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

export const getSpreadDisplay = (symbol: unknown, spread: unknown, bid?: unknown, ask?: unknown): SpreadDisplay => {
  const raw = resolveRawSpread(spread, bid, ask);

  if (raw <= 0) {
    return {
      raw,
      value: 0,
      unit: isForexPair(symbol) || isMetalSymbol(symbol) ? 'pips' : 'price',
      formatted: '0',
    };
  }

  if (isForexPair(symbol)) {
    const value = raw * getForexPipFactor(symbol);
    return {
      raw,
      value,
      unit: 'pips',
      formatted: formatPipSpread(value),
    };
  }

  if (isMetalSymbol(symbol)) {
    const value = raw * 100;
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

export const formatSpreadDisplay = (symbol: unknown, spread: unknown, bid?: unknown, ask?: unknown): string =>
  getSpreadDisplay(symbol, spread, bid, ask).formatted;

export const formatSpreadDisplayWithUnit = (symbol: unknown, spread: unknown, bid?: unknown, ask?: unknown): string => {
  const display = getSpreadDisplay(symbol, spread, bid, ask);
  if (display.formatted === '-') return display.formatted;
  return display.unit === 'pips' ? `${display.formatted} pips` : display.formatted;
};
