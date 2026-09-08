import {
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
} from './brokerSession';

export type MarketWatchDailyChangeSource = 'quote' | 'history';

export interface MarketWatchDailyChangeCacheEntry {
  value: number;
  asOf: number;
  savedAt: number;
  source: MarketWatchDailyChangeSource;
}

export interface MarketWatchDailyChangeInput {
  symbol: string;
  value: number;
  asOf: number;
  source: MarketWatchDailyChangeSource;
}

export interface DailyChangeCandle {
  time: unknown;
  close: unknown;
  closed?: boolean;
}

export interface ResolvedDailyChange {
  value: number;
  asOf: number;
}

interface StoredDailyChangeEntry extends MarketWatchDailyChangeCacheEntry {
  scopeKey: string;
  symbol: string;
}

interface StoredDailyChangeEnvelope {
  version: 1;
  entries: StoredDailyChangeEntry[];
}

export const MARKET_WATCH_DAILY_CHANGE_CACHE_STORAGE_KEY = 'rtx5_market_watch_daily_change_v1';
export const MARKET_WATCH_DAILY_CHANGE_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_MARKET_WATCH_DAILY_CHANGE_CACHE_ENTRIES = 500;

const STORAGE_VERSION = 1 as const;
const FLUSH_DELAY_MS = 250;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const entriesByScope = new Map<string, Map<string, MarketWatchDailyChangeCacheEntry>>();
let loadedFromStorage = false;
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const normalizeSymbol = (symbol: unknown): string => String(symbol ?? '').trim().toUpperCase();

const normalizeScopeKey = (scopeKey: unknown): string => String(scopeKey ?? '').trim();

const getStorage = (): Storage | null => {
  if (typeof window === 'undefined') return null;

  try {
    const storage = window.localStorage;
    return storage && typeof storage.getItem === 'function' ? storage : null;
  } catch {
    return null;
  }
};

const isFiniteTimestamp = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0
);

const isSource = (value: unknown): value is MarketWatchDailyChangeSource => (
  value === 'quote' || value === 'history'
);

const isStoredEntry = (value: unknown): value is StoredDailyChangeEntry => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const entry = value as Partial<StoredDailyChangeEntry>;
  const scopeKey = normalizeScopeKey(entry.scopeKey);
  const symbol = normalizeSymbol(entry.symbol);
  return (
    scopeKey.length > 0
    && entry.scopeKey === scopeKey
    && symbol.length > 0
    && entry.symbol === symbol
    && typeof entry.value === 'number'
    && Number.isFinite(entry.value)
    && isFiniteTimestamp(entry.asOf)
    && isFiniteTimestamp(entry.savedAt)
    && isSource(entry.source)
  );
};

const parseStoredEnvelope = (raw: string | null): StoredDailyChangeEnvelope | null => {
  if (!raw) return { version: STORAGE_VERSION, entries: [] };

  try {
    const parsed = JSON.parse(raw) as Partial<StoredDailyChangeEnvelope>;
    if (
      !parsed
      || typeof parsed !== 'object'
      || Array.isArray(parsed)
      || parsed.version !== STORAGE_VERSION
      || !Array.isArray(parsed.entries)
      || !parsed.entries.every(isStoredEntry)
    ) {
      return null;
    }
    return parsed as StoredDailyChangeEnvelope;
  } catch {
    return null;
  }
};

const sourcePriority = (source: MarketWatchDailyChangeSource): number => (
  source === 'quote' ? 1 : 0
);

const shouldReplaceLoadedEntry = (
  current: MarketWatchDailyChangeCacheEntry | undefined,
  candidate: MarketWatchDailyChangeCacheEntry,
): boolean => {
  if (!current) return true;
  if (candidate.asOf !== current.asOf) return candidate.asOf > current.asOf;
  if (candidate.source !== current.source) {
    return sourcePriority(candidate.source) > sourcePriority(current.source);
  }
  return candidate.savedAt > current.savedAt;
};

const deleteEntry = (scopeKey: string, symbol: string): boolean => {
  const scopedEntries = entriesByScope.get(scopeKey);
  if (!scopedEntries?.delete(symbol)) return false;
  if (scopedEntries.size === 0) entriesByScope.delete(scopeKey);
  return true;
};

const collectEntries = (): StoredDailyChangeEntry[] => {
  const records: StoredDailyChangeEntry[] = [];
  entriesByScope.forEach((scopedEntries, scopeKey) => {
    scopedEntries.forEach((entry, symbol) => {
      records.push({ scopeKey, symbol, ...entry });
    });
  });
  return records;
};

const pruneEntries = (now = Date.now()): boolean => {
  let changed = false;
  const cutoff = now - MARKET_WATCH_DAILY_CHANGE_CACHE_TTL_MS;

  collectEntries().forEach((entry) => {
    if (entry.savedAt <= cutoff) {
      changed = deleteEntry(entry.scopeKey, entry.symbol) || changed;
    }
  });

  const retained = collectEntries().sort((left, right) => (
    right.savedAt - left.savedAt
    || right.asOf - left.asOf
    || sourcePriority(right.source) - sourcePriority(left.source)
    || right.scopeKey.localeCompare(left.scopeKey)
    || right.symbol.localeCompare(left.symbol)
  ));

  retained.slice(MAX_MARKET_WATCH_DAILY_CHANGE_CACHE_ENTRIES).forEach((entry) => {
    changed = deleteEntry(entry.scopeKey, entry.symbol) || changed;
  });
  return changed;
};

const scheduleFlush = (): void => {
  if (flushTimer !== null || !getStorage()) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushMarketWatchDailyChangeCache();
  }, FLUSH_DELAY_MS);
};

const markDirty = (): void => {
  dirty = true;
  scheduleFlush();
};

const ensureLoaded = (): void => {
  if (loadedFromStorage) return;
  loadedFromStorage = true;

  const storage = getStorage();
  if (!storage) return;

  let raw: string | null;
  try {
    raw = storage.getItem(MARKET_WATCH_DAILY_CHANGE_CACHE_STORAGE_KEY);
  } catch {
    return;
  }

  const envelope = parseStoredEnvelope(raw);
  if (!envelope) return;

  envelope.entries.forEach(({ scopeKey, symbol, value, asOf, savedAt, source }) => {
    const scopedEntries = entriesByScope.get(scopeKey) ?? new Map<string, MarketWatchDailyChangeCacheEntry>();
    const candidate = { value, asOf, savedAt, source };
    if (shouldReplaceLoadedEntry(scopedEntries.get(symbol), candidate)) {
      scopedEntries.set(symbol, candidate);
      entriesByScope.set(scopeKey, scopedEntries);
    }
  });

  if (pruneEntries()) markDirty();
};

const readEntry = (
  scopeKey: string,
  symbol: string,
): MarketWatchDailyChangeCacheEntry | null => {
  ensureLoaded();
  const normalizedScopeKey = normalizeScopeKey(scopeKey);
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedScopeKey || !normalizedSymbol) return null;

  const entry = entriesByScope.get(normalizedScopeKey)?.get(normalizedSymbol);
  if (!entry) return null;
  if (entry.savedAt <= Date.now() - MARKET_WATCH_DAILY_CHANGE_CACHE_TTL_MS) {
    if (deleteEntry(normalizedScopeKey, normalizedSymbol)) markDirty();
    return null;
  }
  return entry;
};

export const getCurrentMarketWatchDailyChangeScopeKey = (): string | null => {
  const scope = getCommittedBrokerAccountSessionScope();
  if (!scope.authenticated || !String(scope.accountId ?? '').trim()) return null;
  return getCommittedBrokerAccountSessionScopeKey(scope);
};

export const readMarketWatchDailyChangeEntry = (
  scopeKey: string,
  symbol: string,
): MarketWatchDailyChangeCacheEntry | null => {
  const entry = readEntry(scopeKey, symbol);
  return entry ? { ...entry } : null;
};

export const readMarketWatchDailyChange = (
  scopeKey: string,
  symbol: string,
): number | null => readEntry(scopeKey, symbol)?.value ?? null;

export const readMarketWatchDailyChanges = (
  scopeKey: string,
  symbols: readonly string[],
): Record<string, number> => {
  const values: Record<string, number> = {};
  symbols.forEach((symbol) => {
    const normalizedSymbol = normalizeSymbol(symbol);
    if (!normalizedSymbol || Object.prototype.hasOwnProperty.call(values, normalizedSymbol)) return;
    const value = readMarketWatchDailyChange(scopeKey, normalizedSymbol);
    if (value !== null) values[normalizedSymbol] = value;
  });
  return values;
};

export const readCurrentMarketWatchDailyChange = (symbol: string): number | null => {
  const scopeKey = getCurrentMarketWatchDailyChangeScopeKey();
  return scopeKey ? readMarketWatchDailyChange(scopeKey, symbol) : null;
};

export const readCurrentMarketWatchDailyChanges = (
  symbols: readonly string[],
): Record<string, number> => {
  const scopeKey = getCurrentMarketWatchDailyChangeScopeKey();
  return scopeKey ? readMarketWatchDailyChanges(scopeKey, symbols) : {};
};

const rememberEntry = (
  scopeKey: string,
  symbol: string,
  value: number,
  asOf: number,
  source: MarketWatchDailyChangeSource,
  savedAt: number,
): boolean => {
  const normalizedScopeKey = normalizeScopeKey(scopeKey);
  const normalizedSymbol = normalizeSymbol(symbol);
  if (
    !normalizedScopeKey
    || !normalizedSymbol
    || !Number.isFinite(value)
    || !isFiniteTimestamp(asOf)
    || !isSource(source)
  ) {
    return false;
  }

  const scopedEntries = entriesByScope.get(normalizedScopeKey) ?? new Map<string, MarketWatchDailyChangeCacheEntry>();
  const current = scopedEntries.get(normalizedSymbol);
  if (current) {
    if (asOf < current.asOf) return false;
    if (asOf === current.asOf) {
      if (current.source === 'quote' && source === 'history') return false;
      if (current.source === source && current.value === value) return false;
    }
  }

  scopedEntries.set(normalizedSymbol, { value, asOf, savedAt, source });
  entriesByScope.set(normalizedScopeKey, scopedEntries);
  return true;
};

export const rememberMarketWatchDailyChange = (
  scopeKey: string,
  symbol: string,
  value: number,
  asOf: number,
  source: MarketWatchDailyChangeSource,
): boolean => {
  ensureLoaded();
  const changed = rememberEntry(scopeKey, symbol, value, asOf, source, Date.now());
  if (!changed) return false;

  pruneEntries();
  markDirty();
  return true;
};

export const rememberMarketWatchDailyChanges = (
  scopeKey: string,
  changes: readonly MarketWatchDailyChangeInput[],
): number => {
  ensureLoaded();
  const savedAt = Date.now();
  let changedCount = 0;
  changes.forEach(({ symbol, value, asOf, source }) => {
    if (rememberEntry(scopeKey, symbol, value, asOf, source, savedAt)) changedCount += 1;
  });

  if (changedCount > 0) {
    pruneEntries();
    markDirty();
  }
  return changedCount;
};

export const rememberCurrentMarketWatchDailyChange = (
  symbol: string,
  value: number,
  asOf: number,
  source: MarketWatchDailyChangeSource,
): boolean => {
  const scopeKey = getCurrentMarketWatchDailyChangeScopeKey();
  return scopeKey ? rememberMarketWatchDailyChange(scopeKey, symbol, value, asOf, source) : false;
};

export const rememberCurrentMarketWatchDailyChanges = (
  changes: readonly MarketWatchDailyChangeInput[],
): number => {
  const scopeKey = getCurrentMarketWatchDailyChangeScopeKey();
  return scopeKey ? rememberMarketWatchDailyChanges(scopeKey, changes) : 0;
};

export const flushMarketWatchDailyChangeCache = (): boolean => {
  ensureLoaded();
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!dirty) return false;

  const storage = getStorage();
  if (!storage) {
    dirty = false;
    return false;
  }

  pruneEntries();
  const envelope: StoredDailyChangeEnvelope = {
    version: STORAGE_VERSION,
    entries: collectEntries(),
  };
  try {
    storage.setItem(MARKET_WATCH_DAILY_CHANGE_CACHE_STORAGE_KEY, JSON.stringify(envelope));
    dirty = false;
    return true;
  } catch {
    return false;
  }
};

export const resetMarketWatchDailyChangeCacheForTests = (
  options: { clearStorage?: boolean } = {},
): void => {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  entriesByScope.clear();
  loadedFromStorage = false;
  dirty = false;

  if (options.clearStorage !== false) {
    try {
      getStorage()?.removeItem(MARKET_WATCH_DAILY_CHANGE_CACHE_STORAGE_KEY);
    } catch {
      // Test reset remains safe in storage-restricted runtimes.
    }
  }
};

const normalizeCandleTimeMs = (value: unknown): number | null => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const date = value as { year?: unknown; month?: unknown; day?: unknown };
    const year = Number(date.year);
    const month = Number(date.month);
    const day = Number(date.day);
    if (
      Number.isInteger(year)
      && Number.isInteger(month)
      && Number.isInteger(day)
      && month >= 1
      && month <= 12
      && day >= 1
      && day <= 31
    ) {
      const time = Date.UTC(year, month - 1, day);
      const parsed = new Date(time);
      return (
        parsed.getUTCFullYear() === year
        && parsed.getUTCMonth() === month - 1
        && parsed.getUTCDate() === day
      ) ? time : null;
    }
  }

  if (typeof value === 'string' && value.trim() && !Number.isFinite(Number(value))) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const milliseconds = numeric < 100_000_000_000 ? numeric * 1000 : numeric;
  return Number.isFinite(milliseconds) ? milliseconds : null;
};

export const resolveCompletedDailyChange = (
  candles: readonly DailyChangeCandle[],
  now = Date.now(),
): ResolvedDailyChange | null => {
  if (!Number.isFinite(now) || now < 0) return null;

  const closesByTime = new Map<number, number>();
  candles.forEach((candle) => {
    if (!candle || candle.closed === false) return;
    const time = normalizeCandleTimeMs(candle.time);
    const close = Number(candle.close);
    if (time === null || time > now || !Number.isFinite(close) || close <= 0) return;

    const day = new Date(time).getUTCDay();
    if (day === 0 || day === 6) return;
    if (candle.closed !== true && time + ONE_DAY_MS > now) return;
    closesByTime.set(time, close);
  });

  const completed = [...closesByTime.entries()].sort(([left], [right]) => left - right);
  if (completed.length < 2) return null;

  const [priorTime, priorClose] = completed[completed.length - 2];
  const [lastTime, lastClose] = completed[completed.length - 1];
  if (
    lastTime === priorTime
    || lastTime <= now - MARKET_WATCH_DAILY_CHANGE_CACHE_TTL_MS
    || priorClose <= 0
  ) return null;

  const value = ((lastClose - priorClose) / priorClose) * 100;
  return Number.isFinite(value) ? { value, asOf: lastTime } : null;
};
