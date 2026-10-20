import { pruneSymbolsToUniverse } from './accountSymbolUniverse';
import { resolveMarketWatchSymbolInput } from './marketWatchSource';

export interface MarketWatchGroupSource {
  symbol?: unknown;
  name?: unknown;
  id?: unknown;
  category?: unknown;
  asset_class?: unknown;
  assetClass?: unknown;
  type?: unknown;
  group?: unknown;
  path?: unknown;
}

export interface MarketWatchDefaultSource extends MarketWatchGroupSource {
  bid?: unknown;
  ask?: unknown;
  price?: unknown;
  last?: unknown;
}

export interface MarketWatchSymbolGroup {
  key: string;
  label: string;
  symbols: string[];
  visibleCount: number;
}

interface ResolvedGroup {
  key: string;
  label: string;
}

export const CORE_MARKET_WATCH_SYMBOLS = [
  'XAUUSD',
  'BTCUSD',
  'EURUSD',
] as const;

const GROUP_PRIORITY = new Map([
  ['forex', 0],
  ['metals', 1],
  ['indexes', 2],
  ['nasdaq', 3],
  ['crypto', 4],
  ['commodities', 5],
  ['stocks', 6],
  ['other', 99],
]);

const CURRENCY_CODES = new Set([
  'AED', 'ARS', 'AUD', 'BRL', 'CAD', 'CHF', 'CLP', 'CNH', 'CNY', 'CZK', 'DKK',
  'EUR', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN',
  'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'RUB', 'SAR', 'SEK', 'SGD', 'THB',
  'TRY', 'TWD', 'USD', 'ZAR',
]);

const CRYPTO_BASES = [
  'AAVE', 'ADA', 'AVAX', 'BCH', 'BNB', 'BTC', 'DOGE', 'DOT', 'EOS', 'ETH', 'LINK',
  'LTC', 'MATIC', 'SOL', 'SUSHI', 'TRX', 'UNI', 'XLM', 'XMR', 'XRP',
];
const CRYPTO_QUOTES = [...CURRENCY_CODES, 'BTC', 'ETH', 'USDC', 'USDT'];

const NASDAQ_SYMBOLS = new Set(['NAS100', 'NASDAQ', 'NQ100', 'US100', 'USTEC']);
const INDEX_SYMBOLS = new Set([
  'AUS200', 'CHN50', 'ESP35', 'EUSTX50', 'FRA40', 'GER30', 'GER40', 'HK50',
  'ITA40', 'JPN225', 'UK100', 'US30', 'US500', 'US2000', 'US400',
]);
const COMMODITY_SYMBOLS = new Set([
  'BRENT', 'COCOA', 'COFFEE', 'COPPER', 'CORN', 'NATGAS', 'NGAS', 'SOYBEAN',
  'SUGAR', 'UKOIL', 'USOIL', 'WHEAT', 'WTI',
]);

const normalizeSymbol = (value: unknown): string => String(value ?? '').trim().toUpperCase();

const readSymbol = (source: unknown): string => {
  if (source && typeof source === 'object') {
    const record = source as MarketWatchGroupSource;
    return normalizeSymbol(record.symbol ?? record.name ?? record.id);
  }
  return normalizeSymbol(source);
};

const readCategory = (source: unknown): string => {
  if (!source || typeof source !== 'object') return '';
  const record = source as MarketWatchGroupSource;
  return String(
    record.category
      ?? record.asset_class
      ?? record.assetClass
      ?? record.group
      ?? record.path
      ?? record.type
      ?? '',
  ).trim();
};

const readPositivePrice = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const readRepresentativePrice = (source: unknown): number => {
  if (!source || typeof source !== 'object') return Number.NEGATIVE_INFINITY;
  const record = source as MarketWatchDefaultSource;
  const bid = readPositivePrice(record.bid);
  const ask = readPositivePrice(record.ask);
  if (bid !== null && ask !== null) return (bid + ask) / 2;
  return bid
    ?? ask
    ?? readPositivePrice(record.price)
    ?? readPositivePrice(record.last)
    ?? Number.NEGATIVE_INFINITY;
};

const toGroupKey = (value: string): string => value
  .trim()
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'other';

const toGroupLabel = (value: string): string => value
  .trim()
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .replace(/\b\w/g, (character) => character.toUpperCase());

const knownGroup = (key: string, label: string): ResolvedGroup => ({ key, label });

const resolveExplicitGroup = (category: string): ResolvedGroup | null => {
  if (!category) return null;

  const topLevelCategory = category.split(/[.\\/>|]+/)[0]?.trim() || category.trim();
  const normalized = topLevelCategory.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

  if (/nasdaq|nas 100|us tech|ustec/.test(normalized)) return knownGroup('nasdaq', 'Nasdaq');
  if (/forex|foreign exchange|currenc|\bfx\b/.test(normalized)) return knownGroup('forex', 'Forex');
  if (/metal|bullion/.test(normalized)) return knownGroup('metals', 'Metals');
  if (/indice|index/.test(normalized)) return knownGroup('indexes', 'Indexes');
  if (/crypto|digital asset/.test(normalized)) return knownGroup('crypto', 'Crypto');
  if (/commodit|energy|agricultur/.test(normalized)) return knownGroup('commodities', 'Commodities');
  if (/stock|share|equit/.test(normalized)) return knownGroup('stocks', 'Stocks');

  return {
    key: toGroupKey(topLevelCategory),
    label: toGroupLabel(topLevelCategory) || 'Other',
  };
};

const getSymbolRoot = (symbol: string): string => symbol.replace(/[^A-Z0-9].*$/, '');

const isExcludedDefaultMarketWatchSymbol = (symbol: string): boolean =>
  getSymbolRoot(symbol) === 'GBPUSD';

const resolveFallbackGroup = (symbol: string): ResolvedGroup => {
  const root = getSymbolRoot(symbol);

  if (root === 'EUROUSD') return knownGroup('forex', 'Forex');
  if (/^(XAU|XAG|XPD|XPT)/.test(root)) return knownGroup('metals', 'Metals');
  if (CRYPTO_BASES.some((base) => {
    if (root === base) return true;
    const remainder = root.slice(base.length);
    return root.startsWith(base) && CRYPTO_QUOTES.some((quote) => (
      remainder.startsWith(quote) && remainder.length <= quote.length + 3
    ));
  })) return knownGroup('crypto', 'Crypto');
  if (NASDAQ_SYMBOLS.has(root)) return knownGroup('nasdaq', 'Nasdaq');
  if (INDEX_SYMBOLS.has(root)) return knownGroup('indexes', 'Indexes');
  if (COMMODITY_SYMBOLS.has(root)) return knownGroup('commodities', 'Commodities');

  if (root.length >= 6) {
    const base = root.slice(0, 3);
    const quote = root.slice(3, 6);
    if (CURRENCY_CODES.has(base) && CURRENCY_CODES.has(quote)) {
      return knownGroup('forex', 'Forex');
    }
  }

  if (/^\d{3,6}$/.test(root) || /^[A-Z]{1,5}$/.test(root) || /[._-][A-Z]{1,5}$/.test(symbol)) {
    return knownGroup('stocks', 'Stocks');
  }

  return knownGroup('other', 'Other');
};

export const resolveMarketWatchSymbolGroup = (
  symbol: string,
  category?: string,
): ResolvedGroup => resolveExplicitGroup(String(category ?? '').trim()) ?? resolveFallbackGroup(normalizeSymbol(symbol));

export const buildMarketWatchSymbolGroups = (
  symbols: readonly string[],
  metadataSources: readonly unknown[],
  visibleSymbols: readonly string[] = [],
): MarketWatchSymbolGroup[] => {
  const categoryBySymbol = new Map<string, string>();

  for (const source of metadataSources) {
    const symbol = readSymbol(source);
    const category = readCategory(source);
    if (symbol && category && !categoryBySymbol.has(symbol)) {
      categoryBySymbol.set(symbol, category);
    }
  }

  const visibleSet = new Set(visibleSymbols.map(normalizeSymbol).filter(Boolean));
  const groups = new Map<string, MarketWatchSymbolGroup>();
  const uniqueSymbols = Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right));

  for (const symbol of uniqueSymbols) {
    const resolved = resolveMarketWatchSymbolGroup(symbol, categoryBySymbol.get(symbol));
    const group = groups.get(resolved.key) ?? {
      key: resolved.key,
      label: resolved.label,
      symbols: [],
      visibleCount: 0,
    };

    group.symbols.push(symbol);
    if (visibleSet.has(symbol)) group.visibleCount += 1;
    groups.set(resolved.key, group);
  }

  return Array.from(groups.values()).sort((left, right) => {
    const leftPriority = GROUP_PRIORITY.get(left.key) ?? 50;
    const rightPriority = GROUP_PRIORITY.get(right.key) ?? 50;
    return leftPriority - rightPriority || left.label.localeCompare(right.label);
  });
};

/**
 * Builds the curated built-in Market Watch.
 *
 * The three requested core symbols are a FALLBACK ORDER only: they decide
 * which catalog symbols to try first, never which symbols are allowed. Every
 * returned symbol is intersected with the broker/account catalog (the
 * `sources` universe, further narrowed by `eligibleUniverse` when provided),
 * so a default that the catalog does not expose never renders. Every
 * remaining detected group except Other then contributes one representative:
 * the symbol with the highest current bid/ask midpoint. Symbols without a
 * usable price remain deterministic via an alphabetical fallback. Custom
 * watchlists do not use this selection.
 */
export const selectDefaultMarketWatchSymbols = (
  sources: readonly unknown[],
  metadataSources: readonly unknown[] = sources,
  eligibleUniverse?: readonly unknown[],
): string[] => {
  const symbolUniverse = Array.from(new Set(sources.map(readSymbol).filter(Boolean)));
  if (symbolUniverse.length === 0) return [];

  const defaultSymbolUniverse = symbolUniverse.filter(
    (symbol) => !isExcludedDefaultMarketWatchSymbol(symbol),
  );
  if (defaultSymbolUniverse.length === 0) return [];

  const combinedMetadata = [...metadataSources, ...sources];
  const groups = buildMarketWatchSymbolGroups(defaultSymbolUniverse, combinedMetadata);
  const groupKeyBySymbol = new Map<string, string>();
  groups.forEach((group) => {
    group.symbols.forEach((symbol) => groupKeyBySymbol.set(symbol, group.key));
  });

  const priceBySymbol = new Map<string, number>();
  sources.forEach((source) => {
    const symbol = readSymbol(source);
    if (!symbol) return;
    const price = readRepresentativePrice(source);
    if (price > (priceBySymbol.get(symbol) ?? Number.NEGATIVE_INFINITY)) {
      priceBySymbol.set(symbol, price);
    }
  });

  const selected = CORE_MARKET_WATCH_SYMBOLS
    .map((symbol) => resolveMarketWatchSymbolInput(defaultSymbolUniverse, symbol))
    .filter((symbol): symbol is string => Boolean(symbol));
  const selectedSet = new Set(selected);
  const coveredGroups = new Set(
    selected.map((symbol) => groupKeyBySymbol.get(symbol)).filter(Boolean),
  );

  groups.forEach((group) => {
    if (group.key === 'other' || coveredGroups.has(group.key)) return;
    const representative = [...group.symbols].sort((left, right) => {
      const priceDelta = (priceBySymbol.get(right) ?? Number.NEGATIVE_INFINITY)
        - (priceBySymbol.get(left) ?? Number.NEGATIVE_INFINITY);
      return priceDelta || left.localeCompare(right);
    })[0];
    if (!representative || selectedSet.has(representative)) return;
    selected.push(representative);
    selectedSet.add(representative);
    coveredGroups.add(group.key);
  });

  // The core list is fallback order only: membership is decided by the
  // catalog. Intersect with the eligible universe (the T11 quote-eligible
  // catalog at the call site) via the shared catalog helper so a non-catalog
  // default can never leak into the UI.
  if (eligibleUniverse === undefined) return selected;
  return pruneSymbolsToUniverse(selected, eligibleUniverse);
};
