import {
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
} from './brokerSession';

export type MarketWatchDailyChangeSource = 'quote' | 'history';

export interface MarketWatchDailyChangeCacheEntry {
  value: number;
  asOf: number;
  /**
   * History-only boundary at which the D1 session represented by `asOf`
   * became final. Quote entries use their event timestamp directly.
   */
  completedAt?: number;
  savedAt: number;
  source: MarketWatchDailyChangeSource;
}

export interface MarketWatchDailyChangeInput {
  symbol: string;
  value: number;
  asOf: number;
  completedAt?: number;
  source: MarketWatchDailyChangeSource;
}

export interface DailyChangeCandle {
  time: unknown;
  /** Original broker timestamp before chart-timeframe boundary alignment. */
  sourceTime?: unknown;
  close: unknown;
  closed?: boolean;
}

export interface ResolvedDailyChange {
  value: number;
  /** Broker D1 session-open timestamp. */
  asOf: number;
  /** Session boundary used to order the final D1 result against live quotes. */
  completedAt: number;
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
const MAX_D1_ROLLOVER_GAP_MS = 26 * 60 * 60 * 1000;

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
    && (
      entry.completedAt === undefined
      || (
        entry.source === 'history'
        && isFiniteTimestamp(entry.completedAt)
        && entry.completedAt >= entry.asOf
      )
    )
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

const getEntryOrderingTime = (entry: MarketWatchDailyChangeCacheEntry): number => (
  entry.source === 'history' && entry.completedAt !== undefined
    ? entry.completedAt
    : entry.asOf
);

const compareEntryOrder = (
  left: MarketWatchDailyChangeCacheEntry,
  right: MarketWatchDailyChangeCacheEntry,
): number => (
  getEntryOrderingTime(left) - getEntryOrderingTime(right)
  || sourcePriority(left.source) - sourcePriority(right.source)
  || left.asOf - right.asOf
);

const shouldReplaceLoadedEntry = (
  current: MarketWatchDailyChangeCacheEntry | undefined,
  candidate: MarketWatchDailyChangeCacheEntry,
): boolean => {
  if (!current) return true;
  const order = compareEntryOrder(candidate, current);
  if (order !== 0) return order > 0;
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
    || compareEntryOrder(right, left)
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

  envelope.entries.forEach(({ scopeKey, symbol, value, asOf, completedAt, savedAt, source }) => {
    const scopedEntries = entriesByScope.get(scopeKey) ?? new Map<string, MarketWatchDailyChangeCacheEntry>();
    const candidate: MarketWatchDailyChangeCacheEntry = {
      value,
      asOf,
      savedAt,
      source,
      ...(completedAt !== undefined ? { completedAt } : {}),
    };
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
  if (scope.authenticated && !String(scope.accountId ?? '').trim()) return null;
  if (!scope.authenticated && !scope.brokerId && !scope.serverUrl) return null;
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
  completedAt?: number,
): boolean => {
  const normalizedScopeKey = normalizeScopeKey(scopeKey);
  const normalizedSymbol = normalizeSymbol(symbol);
  if (
    !normalizedScopeKey
    || !normalizedSymbol
    || !Number.isFinite(value)
    || !isFiniteTimestamp(asOf)
    || !isSource(source)
    || (
      completedAt !== undefined
      && (
        source !== 'history'
        || !isFiniteTimestamp(completedAt)
        || completedAt < asOf
      )
    )
  ) {
    return false;
  }

  const scopedEntries = entriesByScope.get(normalizedScopeKey) ?? new Map<string, MarketWatchDailyChangeCacheEntry>();
  const current = scopedEntries.get(normalizedSymbol);
  const candidate: MarketWatchDailyChangeCacheEntry = {
    value,
    asOf,
    savedAt,
    source,
    ...(completedAt !== undefined ? { completedAt } : {}),
  };
  if (current) {
    const order = compareEntryOrder(candidate, current);
    if (order < 0) return false;
    if (
      order === 0
      && current.source === source
      && current.asOf === asOf
      && current.completedAt === completedAt
      && current.value === value
    ) return false;
  }

  scopedEntries.set(normalizedSymbol, candidate);
  entriesByScope.set(normalizedScopeKey, scopedEntries);
  return true;
};

export const rememberMarketWatchDailyChange = (
  scopeKey: string,
  symbol: string,
  value: number,
  asOf: number,
  source: MarketWatchDailyChangeSource,
  completedAt?: number,
): boolean => {
  ensureLoaded();
  const changed = rememberEntry(scopeKey, symbol, value, asOf, source, Date.now(), completedAt);
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
  changes.forEach(({ symbol, value, asOf, completedAt, source }) => {
    if (rememberEntry(scopeKey, symbol, value, asOf, source, savedAt, completedAt)) {
      changedCount += 1;
    }
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
  completedAt?: number,
): boolean => {
  const scopeKey = getCurrentMarketWatchDailyChangeScopeKey();
  return scopeKey
    ? rememberMarketWatchDailyChange(scopeKey, symbol, value, asOf, source, completedAt)
    : false;
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

  const normalized = candles.flatMap((candle, index) => {
    if (!candle) return [];
    const sourceTime = normalizeCandleTimeMs(candle.sourceTime);
    const time = sourceTime ?? normalizeCandleTimeMs(candle.time);
    const close = Number(candle.close);
    if (time === null || time > now || !Number.isFinite(close) || close <= 0) return [];
    return [{ time, close, closed: candle.closed, index }];
  });

  if (normalized.length < 2) return null;

  const latestObservedTime = normalized.reduce(
    (latest, candle) => Math.max(latest, candle.time),
    0,
  );
  const closesByTime = new Map<number, { close: number; finalityRank: number; index: number }>();
  normalized.forEach((candle) => {
    // Broker finality is strongest. A later D1 candle proves the earlier
    // bucket rolled over even when a gateway left `closed:false`. As a final
    // safety net, an otherwise-latest row is usable only after a full nominal
    // D1 period has elapsed. This excludes the current forming row without
    // assuming that UTC Saturday/Sunday labels are non-trading days.
    const finalityRank = candle.closed === true
      ? 3
      : candle.time < latestObservedTime
        ? 2
        : candle.time + ONE_DAY_MS <= now
          ? 1
          : 0;
    if (finalityRank === 0) return;

    const current = closesByTime.get(candle.time);
    if (
      current
      && (current.finalityRank > finalityRank
        || (current.finalityRank === finalityRank && current.index > candle.index))
    ) return;
    closesByTime.set(candle.time, {
      close: candle.close,
      finalityRank,
      index: candle.index,
    });
  });

  const completed = [...closesByTime.entries()].sort(([left], [right]) => left - right);
  if (completed.length < 2) return null;

  const [priorTime, prior] = completed[completed.length - 2];
  const [lastTime, last] = completed[completed.length - 1];
  if (
    lastTime === priorTime
    || lastTime <= now - MARKET_WATCH_DAILY_CHANGE_CACHE_TTL_MS
    || prior.close <= 0
  ) return null;

  const value = ((last.close - prior.close) / prior.close) * 100;
  if (!Number.isFinite(value)) return null;

  const nextObservedTime = normalized.reduce<number | null>((next, candle) => {
    if (candle.time <= lastTime) return next;
    return next === null || candle.time < next ? candle.time : next;
  }, null);
  const nominalCompletedAt = lastTime + ONE_DAY_MS;
  // A following D1 row is the best rollover evidence, including 23/25-hour
  // DST sessions. Large gaps are not treated as one long session: doing so
  // could let stale history overwrite a quote from a genuinely newer day.
  const rolloverCompletedAt = nextObservedTime !== null
    && nextObservedTime - lastTime <= MAX_D1_ROLLOVER_GAP_MS
    ? nextObservedTime
    : nominalCompletedAt;
  const completedAt = Math.min(rolloverCompletedAt, now);

  return { value, asOf: lastTime, completedAt };
};
