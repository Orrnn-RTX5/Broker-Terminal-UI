export interface MarketWatchSourceOptions {
  activeWatchlistId?: string | null;
  activeWatchlistIsDefault?: boolean;
}

const normalizeSearchValue = (value: unknown): string =>
  String(value ?? '').trim().toUpperCase();

const LEGACY_EUROUSD_SYMBOL = 'EUROUSD';
const CANONICAL_EURUSD_SYMBOL = 'EURUSD';

/**
 * Normalized broker symbol text used inside Market Watch.
 */
export const getMarketWatchSymbolLabel = (
  symbol: string,
  symbolUniverse: readonly string[] = [],
): string => {
  void symbolUniverse;
  const normalizedSymbol = normalizeSearchValue(symbol);
  return normalizedSymbol === LEGACY_EUROUSD_SYMBOL
    ? CANONICAL_EURUSD_SYMBOL
    : normalizedSymbol;
};

const getUniqueSymbolUniverse = (symbols: readonly string[]): string[] =>
  Array.from(new Set(symbols.map(normalizeSearchValue).filter(Boolean)));

/**
 * Resolves symbol input to a real broker symbol. Exact broker symbols always
 * win. The former EUROUSD display alias continues to resolve to EURUSD so
 * persisted input remains compatible. If the broker exposes a real EUROUSD
 * instrument, exact matching keeps both instruments unambiguous.
 */
export const resolveMarketWatchSymbolInput = (
  symbols: readonly string[],
  input: string,
): string | undefined => {
  const normalizedInput = normalizeSearchValue(input);
  if (!normalizedInput) return undefined;

  const uniqueUniverse = getUniqueSymbolUniverse(symbols);
  const exactBrokerSymbol = uniqueUniverse.find((symbol) => symbol === normalizedInput);
  if (exactBrokerSymbol) return exactBrokerSymbol;

  if (
    normalizedInput === LEGACY_EUROUSD_SYMBOL
    && uniqueUniverse.includes(CANONICAL_EURUSD_SYMBOL)
  ) {
    return CANONICAL_EURUSD_SYMBOL;
  }

  return uniqueUniverse.find(
    (symbol) => getMarketWatchSymbolLabel(symbol, uniqueUniverse) === normalizedInput,
  );
};

const normalizeErrorMessage = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (value instanceof Error) return value.message.trim();
  return '';
};

export const isStaleQuoteErrorMessage = (value: unknown): boolean => {
  const message = normalizeErrorMessage(value);
  if (!message) return false;

  return /\bquote\s+is\s+stale\s+for\b/i.test(message)
    || /\bno\s+fresh\s+quote\s+is\s+available\s+for\b/i.test(message)
    || /\bstale\s+quote\s+(?:is\s+available\s+)?for\b/i.test(message)
    || /\bquote[_\s-]*stale\b/i.test(message);
};

export const getMarketWatchDisplayErrors = (...errors: readonly unknown[]): string[] => {
  const messages: string[] = [];
  const seen = new Set<string>();

  for (const error of errors) {
    const message = normalizeErrorMessage(error);
    if (!message || seen.has(message)) continue;

    seen.add(message);
    messages.push(message);
  }

  return messages;
};

export const searchMarketWatchSymbols = (
  symbols: readonly string[],
  query: string,
  limit = 15,
): string[] => {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery || limit <= 0) return [];

  const uniqueUniverse = getUniqueSymbolUniverse(symbols);
  const matchesByLabel = new Map<string, string>();

  for (const symbol of uniqueUniverse) {
    const label = getMarketWatchSymbolLabel(symbol, uniqueUniverse);
    if (!symbol.includes(normalizedQuery) && !label.includes(normalizedQuery)) continue;

    const existing = matchesByLabel.get(label);
    const isExactBrokerLabel = symbol === label;
    const existingIsExactBrokerLabel = existing === label;

    if (!existing || (isExactBrokerLabel && !existingIsExactBrokerLabel)) {
      matchesByLabel.set(label, symbol);
    }
  }

  return Array.from(matchesByLabel.values()).slice(0, Math.floor(limit));
};

export const shouldUseWatchlistAsMarketWatchSource = ({
  activeWatchlistId,
  activeWatchlistIsDefault,
}: MarketWatchSourceOptions): boolean => {
  const id = String(activeWatchlistId ?? '').trim();
  return Boolean(id && activeWatchlistIsDefault === false);
};
