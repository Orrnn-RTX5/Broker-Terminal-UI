type TradeLevelRecord = {
  id?: number | string | null;
  ticket?: number | string | null;
  positionId?: number | string | null;
  position_id?: number | string | null;
  position_ticket?: number | string | null;
  position?: number | string | null;
  orderTicket?: number | string | null;
  order_ticket?: number | string | null;
  order?: number | string | null;
  symbol?: string | null;
  side?: string | null;
  volume?: number | string | null;
  openPrice?: number | string | null;
  price_open?: number | string | null;
  open_price?: number | string | null;
  entryPrice?: number | string | null;
  openTime?: number | string | null;
  time_create?: number | string | null;
  time_open?: number | string | null;
  entryTime?: number | string | null;
  sl?: number | string | null;
  tp?: number | string | null;
  price_sl?: number | string | null;
  price_tp?: number | string | null;
  status?: string | null;
  type?: string | null;
  historySource?: string | null;
};

type CachedTradeLevels = {
  symbol?: string;
  side?: string;
  volume?: number;
  openPrice?: number;
  openTime?: string;
  sl: number;
  tp: number;
  updatedAt: number;
};

type TradeLevelCache = Record<string, CachedTradeLevels>;

const TRADE_HISTORY_LEVEL_CACHE_KEY = 'rtx5_trade_history_levels_v1';
const MAX_CACHE_AGE_MS = 45 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ROWS = 1000;

const isBrowser = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const finiteNumber = (value: unknown): number | undefined => {
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
};

const positiveNumber = (value: unknown): number | undefined => {
  const next = finiteNumber(value);
  return next !== undefined && next > 0 ? next : undefined;
};

const normalizeSymbol = (value: unknown): string => String(value ?? '').trim().toUpperCase();

const normalizeSide = (value: unknown): string => String(value ?? '').trim().toUpperCase();

const normalizeCacheNumber = (value: unknown, digits = 8): string | null => {
  const next = finiteNumber(value);
  return next !== undefined && next > 0 ? next.toFixed(digits) : null;
};

const normalizeTime = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const ms = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    return new Date(ms).toISOString();
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};

const resolveStoredLogin = (): string => {
  if (!isBrowser()) return 'default';

  const candidates = [
    window.localStorage.getItem('rtx_saved_username'),
    window.localStorage.getItem('rtx_last_login'),
    window.localStorage.getItem('account_login'),
  ];

  for (const candidate of candidates) {
    const parsed = Number.parseInt(candidate || '', 10);
    if (Number.isFinite(parsed) && parsed > 0) return String(parsed);
  }

  return 'default';
};

const normalizeLogin = (login?: number | string | null): string => {
  const parsed = Number.parseInt(String(login ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : resolveStoredLogin();
};

const scopedKey = (key: string, login?: number | string | null): string => `${normalizeLogin(login)}:${key}`;

const readCache = (): TradeLevelCache => {
  if (!isBrowser()) return {};

  try {
    const parsed = JSON.parse(window.localStorage.getItem(TRADE_HISTORY_LEVEL_CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as TradeLevelCache : {};
  } catch {
    return {};
  }
};

const writeCache = (cache: TradeLevelCache) => {
  if (!isBrowser()) return;
  window.localStorage.setItem(TRADE_HISTORY_LEVEL_CACHE_KEY, JSON.stringify(cache));
};

const pruneCache = (cache: TradeLevelCache): TradeLevelCache => {
  const cutoff = Date.now() - MAX_CACHE_AGE_MS;
  const entries = Object.entries(cache)
    .filter(([, value]) => Number(value?.updatedAt ?? 0) >= cutoff)
    .sort((a, b) => Number(b[1]?.updatedAt ?? 0) - Number(a[1]?.updatedAt ?? 0))
    .slice(0, MAX_CACHE_ROWS);

  return Object.fromEntries(entries);
};

const getRecordPositionId = (record: TradeLevelRecord): number | undefined => (
  positiveNumber(record.positionId)
  ?? positiveNumber(record.position_id)
  ?? positiveNumber(record.position_ticket)
  ?? positiveNumber(record.position)
  ?? positiveNumber(record.ticket)
  ?? positiveNumber(record.id)
);

// Every value buildLookupKeys or the cached level snapshot resolves, in their
// alias order. Quote/P&L updates can skip storage entirely when these inputs
// are unchanged; an alias that only repeats its canonical value (a stream merge
// adding price_sl beside sl) resolves the same and is not a change.
const readTradeLevelInputs = (record: TradeLevelRecord): readonly unknown[] => [
  getRecordPositionId(record),
  record.orderTicket ?? record.order_ticket ?? record.order,
  record.symbol,
  record.side,
  record.volume,
  record.openPrice ?? record.price_open ?? record.open_price ?? record.entryPrice,
  record.openTime ?? record.time_open ?? record.time_create ?? record.entryTime,
  record.price_sl ?? record.sl,
  record.price_tp ?? record.tp,
];

export const hasTradeHistoryPositionLevelChanges = (
  previous: TradeLevelRecord | undefined,
  next: TradeLevelRecord,
): boolean => {
  if (!previous) return true;
  const previousInputs = readTradeLevelInputs(previous);
  return readTradeLevelInputs(next).some((value, index) => value !== previousInputs[index]);
};

const buildSignatureKey = (record: TradeLevelRecord): string | null => {
  const symbol = normalizeSymbol(record.symbol);
  const side = normalizeSide(record.side);
  const volume = normalizeCacheNumber(record.volume, 4);
  const openPrice = normalizeCacheNumber(record.openPrice ?? record.price_open ?? record.open_price ?? record.entryPrice);
  const openTime = normalizeTime(record.openTime ?? record.time_open ?? record.time_create ?? record.entryTime);

  if (!symbol || !side || !volume || !openPrice || !openTime) return null;
  return `${symbol}:signature:${side}:${volume}:${openPrice}:${openTime}`;
};

const buildLookupKeys = (record: TradeLevelRecord, login?: number | string | null): string[] => {
  const keys: string[] = [];
  const symbol = normalizeSymbol(record.symbol);
  const positionId = getRecordPositionId(record);

  if (positionId) {
    keys.push(scopedKey(`position:${positionId}`, login));
    if (symbol) keys.push(scopedKey(`${symbol}:position:${positionId}`, login));
  }

  const orderTicket = positiveNumber(record.orderTicket ?? record.order_ticket ?? record.order);
  if (orderTicket) {
    keys.push(scopedKey(`order:${orderTicket}`, login));
    if (symbol) keys.push(scopedKey(`${symbol}:order:${orderTicket}`, login));
  }

  const signature = buildSignatureKey(record);
  if (signature) keys.push(scopedKey(signature, login));

  return Array.from(new Set(keys));
};

const levelsChanged = (cached: CachedTradeLevels | undefined, next: CachedTradeLevels): boolean => (
  !cached ||
  cached.symbol !== next.symbol ||
  cached.side !== next.side ||
  cached.volume !== next.volume ||
  cached.openPrice !== next.openPrice ||
  cached.openTime !== next.openTime ||
  cached.sl !== next.sl ||
  cached.tp !== next.tp
);

export const rememberTradeHistoryPositionLevels = (
  positions: TradeLevelRecord[],
  login?: number | string | null,
) => {
  if (!isBrowser() || positions.length === 0) return;

  const cache = pruneCache(readCache());
  const now = Date.now();
  let changed = false;

  for (const position of positions) {
    const keys = buildLookupKeys(position, login);
    if (keys.length === 0) continue;

    const next: CachedTradeLevels = {
      symbol: normalizeSymbol(position.symbol) || undefined,
      side: normalizeSide(position.side) || undefined,
      volume: finiteNumber(position.volume),
      openPrice: finiteNumber(position.openPrice ?? position.price_open ?? position.open_price ?? position.entryPrice),
      openTime: normalizeTime(position.openTime ?? position.time_open ?? position.time_create ?? position.entryTime) ?? undefined,
      sl: finiteNumber(position.price_sl ?? position.sl) ?? 0,
      tp: finiteNumber(position.price_tp ?? position.tp) ?? 0,
      updatedAt: now,
    };

    for (const key of keys) {
      if (!levelsChanged(cache[key], next)) continue;
      cache[key] = next;
      changed = true;
    }
  }

  if (changed) writeCache(pruneCache(cache));
};

const hasTradeLevel = (value: unknown): boolean => {
  const next = finiteNumber(value);
  return next !== undefined && next > 0;
};

export const enrichTradesWithCachedLevels = <T extends TradeLevelRecord>(
  trades: T[],
  login?: number | string | null,
): T[] => {
  if (!isBrowser() || trades.length === 0) return trades;

  const cache = readCache();
  return trades.map((trade) => {
    const hasSl = hasTradeLevel(trade.price_sl ?? trade.sl);
    const hasTp = hasTradeLevel(trade.price_tp ?? trade.tp);
    if (hasSl && hasTp) return trade;

    const cached = buildLookupKeys(trade, login)
      .map((key) => cache[key])
      .find(Boolean);

    if (!cached) return trade;

    const nextSl = hasSl ? finiteNumber(trade.price_sl ?? trade.sl) : cached.sl;
    const nextTp = hasTp ? finiteNumber(trade.price_tp ?? trade.tp) : cached.tp;
    if (!hasTradeLevel(nextSl) && !hasTradeLevel(nextTp)) return trade;

    return {
      ...trade,
      sl: hasSl ? finiteNumber(trade.sl ?? trade.price_sl) : nextSl,
      tp: hasTp ? finiteNumber(trade.tp ?? trade.price_tp) : nextTp,
    };
  });
};
