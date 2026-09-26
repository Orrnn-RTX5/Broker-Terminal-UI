import type { Tick } from '../store/useAppStore';
import { formatBrokerServerTime } from '../services/brokerServerClock';

export const MARKET_WATCH_COLUMNS_STORAGE_KEY = 'rtx5_marketwatch_cols';
export const MARKET_WATCH_OPTIONS_STORAGE_KEY = 'rtx5_marketwatch_options';
export const MARKET_WATCH_SYMBOL_SETS_STORAGE_KEY = 'rtx5_symbol_sets';
export const MARKET_WATCH_SYMBOL_SET_COLUMNS_STORAGE_KEY = 'rtx5_symbol_set_columns';

export const MARKET_WATCH_COLUMN_IDS = [
  'symbol',
  'bid',
  'ask',
  'last',
  'high',
  'low',
  'volume',
  'spread',
  'time',
  'dailyChange',
  'source',
] as const;

export type MarketWatchColumnId = typeof MARKET_WATCH_COLUMN_IDS[number];
export type MarketWatchSortMode = 'symbol' | 'industry' | 'sector' | 'gainers' | 'losers' | 'volume' | null;

export interface MarketWatchOptions {
  useSystemColors: boolean;
  showMilliseconds: boolean;
  autoRemoveExpired: boolean;
  autoArrange: boolean;
  showGrid: boolean;
}

export interface MarketWatchSavedSet {
  symbols: string[];
  columns: MarketWatchColumnId[];
}

export interface MarketWatchSortMetadata {
  industry?: string;
  sector?: string;
}

export const DEFAULT_MARKET_WATCH_COLUMNS: MarketWatchColumnId[] = [
  'symbol',
  'bid',
  'ask',
  'dailyChange',
];

export const DEFAULT_MARKET_WATCH_OPTIONS: MarketWatchOptions = {
  useSystemColors: true,
  showMilliseconds: false,
  autoRemoveExpired: false,
  autoArrange: true,
  showGrid: true,
};

const normalizeSymbol = (value: unknown): string => String(value ?? '').trim().toUpperCase();

const readJson = (key: string): unknown => {
  if (typeof localStorage === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
};

const writeJson = (key: string, value: unknown): void => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in privacy-restricted or embedded runtimes.
  }
};

export const normalizeMarketWatchColumns = (value: unknown): MarketWatchColumnId[] => {
  if (!Array.isArray(value)) return [...DEFAULT_MARKET_WATCH_COLUMNS];
  const supported = new Set<string>(MARKET_WATCH_COLUMN_IDS);
  const columns = Array.from(new Set(
    value.filter((column): column is string => typeof column === 'string' && supported.has(column)),
  )) as MarketWatchColumnId[];
  const optionalColumns = columns.filter((column) => !['symbol', 'bid', 'ask'].includes(column));
  return ['symbol', 'bid', 'ask', ...optionalColumns];
};

export const loadMarketWatchColumns = (): MarketWatchColumnId[] => (
  normalizeMarketWatchColumns(readJson(MARKET_WATCH_COLUMNS_STORAGE_KEY))
);

export const saveMarketWatchColumns = (columns: readonly MarketWatchColumnId[]): void => {
  writeJson(MARKET_WATCH_COLUMNS_STORAGE_KEY, normalizeMarketWatchColumns(columns));
};

export const normalizeMarketWatchOptions = (value: unknown): MarketWatchOptions => {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    useSystemColors: typeof record.useSystemColors === 'boolean'
      ? record.useSystemColors
      : DEFAULT_MARKET_WATCH_OPTIONS.useSystemColors,
    showMilliseconds: typeof record.showMilliseconds === 'boolean'
      ? record.showMilliseconds
      : DEFAULT_MARKET_WATCH_OPTIONS.showMilliseconds,
    autoRemoveExpired: typeof record.autoRemoveExpired === 'boolean'
      ? record.autoRemoveExpired
      : DEFAULT_MARKET_WATCH_OPTIONS.autoRemoveExpired,
    autoArrange: typeof record.autoArrange === 'boolean'
      ? record.autoArrange
      : DEFAULT_MARKET_WATCH_OPTIONS.autoArrange,
    showGrid: typeof record.showGrid === 'boolean'
      ? record.showGrid
      : DEFAULT_MARKET_WATCH_OPTIONS.showGrid,
  };
};

export const loadMarketWatchOptions = (): MarketWatchOptions => (
  normalizeMarketWatchOptions(readJson(MARKET_WATCH_OPTIONS_STORAGE_KEY))
);

export const saveMarketWatchOptions = (options: MarketWatchOptions): void => {
  writeJson(MARKET_WATCH_OPTIONS_STORAGE_KEY, normalizeMarketWatchOptions(options));
};

const normalizeSymbolList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(normalizeSymbol).filter(Boolean))).slice(0, 5_000);
};

export const loadMarketWatchSavedSets = (): Record<string, MarketWatchSavedSet> => {
  const rawSets = readJson(MARKET_WATCH_SYMBOL_SETS_STORAGE_KEY);
  const rawColumns = readJson(MARKET_WATCH_SYMBOL_SET_COLUMNS_STORAGE_KEY);
  const columnsByName = rawColumns && typeof rawColumns === 'object'
    ? rawColumns as Record<string, unknown>
    : {};
  if (!rawSets || typeof rawSets !== 'object' || Array.isArray(rawSets)) return {};

  return Object.fromEntries(Object.entries(rawSets as Record<string, unknown>)
    .slice(0, 100)
    .flatMap(([rawName, rawSet]) => {
      const name = rawName.trim().slice(0, 100);
      if (!name) return [];
      const record = rawSet && typeof rawSet === 'object' && !Array.isArray(rawSet)
        ? rawSet as Record<string, unknown>
        : null;
      const symbols = normalizeSymbolList(record?.symbols ?? rawSet);
      const columns = normalizeMarketWatchColumns(record?.columns ?? columnsByName[name]);
      return [[name, { symbols, columns }] as const];
    }));
};

export const saveMarketWatchSavedSet = (
  name: string,
  symbols: readonly string[],
  columns: readonly MarketWatchColumnId[],
): Record<string, MarketWatchSavedSet> => {
  const normalizedName = name.trim().slice(0, 100);
  const sets = loadMarketWatchSavedSets();
  if (!normalizedName) return sets;
  sets[normalizedName] = {
    symbols: normalizeSymbolList(symbols),
    columns: normalizeMarketWatchColumns(columns),
  };
  // Keep the legacy symbols-only shape so workspace profiles and older builds
  // can still restore a set. Column selections are persisted alongside it.
  writeJson(
    MARKET_WATCH_SYMBOL_SETS_STORAGE_KEY,
    Object.fromEntries(Object.entries(sets).map(([setName, set]) => [setName, set.symbols])),
  );
  writeJson(
    MARKET_WATCH_SYMBOL_SET_COLUMNS_STORAGE_KEY,
    Object.fromEntries(Object.entries(sets).map(([setName, set]) => [setName, set.columns])),
  );
  return sets;
};

export const deleteMarketWatchSavedSet = (name: string): Record<string, MarketWatchSavedSet> => {
  const sets = loadMarketWatchSavedSets();
  delete sets[name];
  writeJson(
    MARKET_WATCH_SYMBOL_SETS_STORAGE_KEY,
    Object.fromEntries(Object.entries(sets).map(([setName, set]) => [setName, set.symbols])),
  );
  writeJson(
    MARKET_WATCH_SYMBOL_SET_COLUMNS_STORAGE_KEY,
    Object.fromEntries(Object.entries(sets).map(([setName, set]) => [setName, set.columns])),
  );
  return sets;
};

const readSortableNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const sortMarketWatchSymbols = (
  symbols: readonly string[],
  mode: MarketWatchSortMode,
  getTick: (symbol: string) => Pick<Tick, 'dailyChange' | 'volume'> | null | undefined,
  metadata: ReadonlyMap<string, MarketWatchSortMetadata>,
): string[] => {
  if (!mode) return [...symbols];
  const originalOrder = new Map(symbols.map((symbol, index) => [symbol, index] as const));
  const stableFallback = (left: string, right: string) => (
    (originalOrder.get(left) ?? 0) - (originalOrder.get(right) ?? 0)
  );

  return [...symbols].sort((left, right) => {
    if (mode === 'symbol') return left.localeCompare(right) || stableFallback(left, right);
    if (mode === 'industry' || mode === 'sector') {
      const leftValue = String(metadata.get(left)?.[mode] ?? '');
      const rightValue = String(metadata.get(right)?.[mode] ?? '');
      if (!leftValue && rightValue) return 1;
      if (leftValue && !rightValue) return -1;
      return leftValue.localeCompare(rightValue) || left.localeCompare(right) || stableFallback(left, right);
    }

    const field = mode === 'volume' ? 'volume' : 'dailyChange';
    const leftValue = readSortableNumber(getTick(left)?.[field]);
    const rightValue = readSortableNumber(getTick(right)?.[field]);
    if (leftValue === null && rightValue !== null) return 1;
    if (leftValue !== null && rightValue === null) return -1;
    if (leftValue !== null && rightValue !== null && leftValue !== rightValue) {
      return mode === 'losers' ? leftValue - rightValue : rightValue - leftValue;
    }
    return left.localeCompare(right) || stableFallback(left, right);
  });
};

export const formatMarketWatchTime = (timestamp: unknown, showMilliseconds: boolean): string => {
  const parsed = Number(timestamp);
  if (!Number.isFinite(parsed) || parsed <= 0) return '-';
  const millis = parsed < 1_000_000_000_000 ? parsed * 1_000 : parsed;
  const date = new Date(millis);
  if (!Number.isFinite(date.getTime())) return '-';
  const base = formatBrokerServerTime(millis).time;
  return showMilliseconds ? `${base}.${String(date.getUTCMilliseconds()).padStart(3, '0')}` : base;
};

const neutralizeSpreadsheetFormula = (value: unknown): string => {
  const text = String(value ?? '');
  // The Market Watch uses a lone dash for unavailable values. It is display
  // data, not a formula, and should remain a clean dash in exported tables.
  if (/^\s*-\s*$/u.test(text)) return text;
  return /^\s*[=+\-@]/u.test(text) ? `'${text}` : text;
};

export const escapeMarketWatchCsvCell = (value: unknown): string => {
  const text = neutralizeSpreadsheetFormula(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const escapeMarketWatchTsvCell = (value: unknown): string => (
  neutralizeSpreadsheetFormula(value).replace(/[\t\r\n]+/g, ' ')
);
