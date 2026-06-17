import { getSymbolDigits } from '../utils/symbolUtils';

const PRICE_UNIT_SPREAD_PREFIXES = [
  'BTC',
  'ETH',
  'LTC',
  'XRP',
  'BCH',
  'ADA',
  'SOL',
  'DOT',
  'LINK',
  'MATIC',
  'UNI',
  'AAVE',
  'SUSHI',
  'XAU',
  'XAG',
  'XPT',
  'XPD',
  'US30',
  'US500',
  'USTEC',
  'NAS',
  'SPX',
  'DJ',
  'NDX',
  'GER40',
  'UK100',
  'FRA40',
  'ESP35',
  'ITA40',
  'AUS200',
  'JPN225',
  'HK50',
  'CHN50',
  'EUSTX50',
  'USOIL',
  'UKOIL',
  'NATGAS',
  'COPPER',
  'CORN',
  'WHEAT',
  'SOYBEAN',
  'COCOA',
  'COFFEE',
  'SUGAR',
] as const;

const normalizeSymbol = (symbol: string): string =>
  symbol.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

const shouldDisplaySpreadInPriceUnits = (symbol: string): boolean => {
  const normalized = normalizeSymbol(symbol);
  return PRICE_UNIT_SPREAD_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};

export const formatMarketWatchSpread = (spread: number, symbol: string): string => {
  if (!Number.isFinite(spread) || spread < 0) return '-';

  if (shouldDisplaySpreadInPriceUnits(symbol)) {
    return spread.toFixed(getSymbolDigits(symbol));
  }

  const normalized = normalizeSymbol(symbol);
  const multiplier = normalized.includes('JPY') ? 100 : 10000;
  return String(Math.round(spread * multiplier));
};
