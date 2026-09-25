import {
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
} from './brokerSession';

/** Last genuine two-sided quote for display only; never a live/tradable tick. */
export interface MarketWatchQuote {
  bid: number;
  ask: number;
  /** Original broker event time in milliseconds, not the local receipt time. */
  asOf: number;
}

interface StoredQuote extends MarketWatchQuote {
  scopeKey: string;
  symbol: string;
  savedAt: number;
}

export const MARKET_WATCH_QUOTE_CACHE_STORAGE_KEY = 'rtx5_market_watch_quotes_v1';
export const MARKET_WATCH_QUOTE_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_MARKET_WATCH_QUOTE_CACHE_ENTRIES = 500;

const entriesByScope = new Map<string, Map<string, StoredQuote>>();
let entryCount = 0;
let loadedFromStorage = false;
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const normalizeSymbol = (symbol: unknown): string => String(symbol ?? '').trim().toUpperCase();
const normalizeScopeKey = (scopeKey: unknown): string => String(scopeKey ?? '').trim();
const isPositiveFinite = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value > 0
);

const getStorage = (): Storage | null => {
  if (typeof window === 'undefined') return null;
  try {
    const storage = window.localStorage;
    return storage && typeof storage.getItem === 'function' ? storage : null;
  } catch {
    return null;
  }
};

const isQuote = (value: unknown): value is MarketWatchQuote => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const quote = value as Partial<MarketWatchQuote>;
  return isPositiveFinite(quote.bid) && isPositiveFinite(quote.ask) && isPositiveFinite(quote.asOf);
};

const isStoredQuote = (value: unknown): value is StoredQuote => {
  if (!isQuote(value)) return false;
  const entry = value as Partial<StoredQuote>;
  const scopeKey = normalizeScopeKey(entry.scopeKey);
  const symbol = normalizeSymbol(entry.symbol);
  return scopeKey.length > 0 && entry.scopeKey === scopeKey
    && symbol.length > 0 && entry.symbol === symbol
    && isPositiveFinite(entry.savedAt);
};

const collectEntries = (): StoredQuote[] => (
  [...entriesByScope.values()].flatMap((entries) => [...entries.values()])
);

const deleteEntry = (entry: StoredQuote): void => {
  const scopedEntries = entriesByScope.get(entry.scopeKey);
  if (scopedEntries?.delete(entry.symbol)) entryCount -= 1;
  if (scopedEntries?.size === 0) entriesByScope.delete(entry.scopeKey);
};

const hasInvalidSourceTime = (entry: MarketWatchQuote, now = Date.now()): boolean => (
  entry.asOf <= now - MARKET_WATCH_QUOTE_CACHE_TTL_MS || entry.asOf > now
);

const pruneEntries = (): boolean => {
  const entries = collectEntries();
  const retained: StoredQuote[] = [];
  let changed = false;
  const now = Date.now();
  entries.forEach((entry) => {
    if (hasInvalidSourceTime(entry, now)) {
      deleteEntry(entry);
      changed = true;
    } else {
      retained.push(entry);
    }
  });
  if (retained.length > MAX_MARKET_WATCH_QUOTE_CACHE_ENTRIES) {
    retained.sort((left, right) => (
      right.asOf - left.asOf || right.savedAt - left.savedAt
      || right.scopeKey.localeCompare(left.scopeKey) || right.symbol.localeCompare(left.symbol)
    ));
    retained.slice(MAX_MARKET_WATCH_QUOTE_CACHE_ENTRIES).forEach((entry) => {
      deleteEntry(entry);
      changed = true;
    });
  }
  return changed;
};

const markDirty = (): void => {
  dirty = true;
  if (flushTimer !== null || !getStorage()) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushMarketWatchQuoteCache();
  }, 250);
};

const ensureLoaded = (): void => {
  if (loadedFromStorage) return;
  loadedFromStorage = true;
  const storage = getStorage();
  if (!storage) return;

  try {
    const raw = storage.getItem(MARKET_WATCH_QUOTE_CACHE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { version?: unknown; entries?: unknown } | null;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)
      || !parsed.entries.every(isStoredQuote)) return;

    let discardedInvalidTime = false;
    parsed.entries.forEach((entry: StoredQuote) => {
      if (hasInvalidSourceTime(entry)) {
        discardedInvalidTime = true;
        return;
      }
      const scopedEntries = entriesByScope.get(entry.scopeKey) ?? new Map<string, StoredQuote>();
      const current = scopedEntries.get(entry.symbol);
      if (!current || entry.asOf > current.asOf
        || (entry.asOf === current.asOf && entry.savedAt > current.savedAt)) {
        if (!current) entryCount += 1;
        scopedEntries.set(entry.symbol, entry);
        entriesByScope.set(entry.scopeKey, scopedEntries);
      }
    });
    const pruned = pruneEntries();
    if (pruned || discardedInvalidTime) markDirty();
  } catch {
    // Malformed or inaccessible storage must not prevent quote display.
  }
};

export const readMarketWatchQuotes = (
  scopeKey: string,
  symbols: readonly string[],
): Record<string, MarketWatchQuote> => {
  ensureLoaded();
  const values: Record<string, MarketWatchQuote> = {};
  const scopedEntries = entriesByScope.get(normalizeScopeKey(scopeKey));
  if (!scopedEntries) return values;
  symbols.forEach((symbol) => {
    const key = normalizeSymbol(symbol);
    const entry = scopedEntries.get(key);
    if (!entry) return;
    if (hasInvalidSourceTime(entry)) {
      deleteEntry(entry);
      markDirty();
      return;
    }
    values[key] = { bid: entry.bid, ask: entry.ask, asOf: entry.asOf };
  });
  return values;
};

export const rememberMarketWatchQuote = (
  scopeKey: string,
  symbol: string,
  quote: MarketWatchQuote,
): boolean => {
  ensureLoaded();
  const normalizedScopeKey = normalizeScopeKey(scopeKey);
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedScopeKey || !normalizedSymbol || !isQuote(quote) || hasInvalidSourceTime(quote)) return false;

  const scopedEntries = entriesByScope.get(normalizedScopeKey) ?? new Map<string, StoredQuote>();
  const current = scopedEntries.get(normalizedSymbol);
  if (current && (quote.asOf < current.asOf
    || (quote.asOf === current.asOf && quote.bid === current.bid && quote.ask === current.ask))) {
    return false;
  }
  scopedEntries.set(normalizedSymbol, {
    scopeKey: normalizedScopeKey,
    symbol: normalizedSymbol,
    bid: quote.bid,
    ask: quote.ask,
    asOf: quote.asOf,
    savedAt: Date.now(),
  });
  if (!current) entryCount += 1;
  entriesByScope.set(normalizedScopeKey, scopedEntries);
  // Existing-symbol ticks are the hot path. Defer expiry scans and sorting to
  // the coalesced flush; only growing beyond the memory bound needs a trim now.
  if (entryCount > MAX_MARKET_WATCH_QUOTE_CACHE_ENTRIES) pruneEntries();
  markDirty();
  return true;
};

export const rememberCurrentMarketWatchQuote = (symbol: string, quote: MarketWatchQuote): boolean => {
  const scope = getCommittedBrokerAccountSessionScope();
  if (!scope.authenticated || !String(scope.accountId ?? '').trim()) return false;
  return rememberMarketWatchQuote(getCommittedBrokerAccountSessionScopeKey(scope), symbol, quote);
};

export const flushMarketWatchQuoteCache = (): boolean => {
  ensureLoaded();
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  if (!dirty) return false;
  const storage = getStorage();
  if (!storage) return false;
  pruneEntries();
  try {
    storage.setItem(MARKET_WATCH_QUOTE_CACHE_STORAGE_KEY, JSON.stringify({
      version: 1,
      entries: collectEntries(),
    }));
    dirty = false;
    return true;
  } catch {
    // Keep the in-memory quotes and allow a later explicit flush to retry.
    return false;
  }
};

export const resetMarketWatchQuoteCacheForTests = (
  options: { clearStorage?: boolean } = {},
): void => {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  entriesByScope.clear();
  entryCount = 0;
  loadedFromStorage = false;
  dirty = false;
  if (options.clearStorage !== false) {
    try {
      getStorage()?.removeItem(MARKET_WATCH_QUOTE_CACHE_STORAGE_KEY);
    } catch {
      // Reset remains safe when browser storage is unavailable.
    }
  }
};
