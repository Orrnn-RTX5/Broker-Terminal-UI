import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  apiClient,
  ApiError,
  type ApiRequestContext,
  type ApiRequestOptions,
} from '../api/client';
import { watchlistV2Api } from '../api/trade';
import { API_V2_BASE_URL, MARKET_WS_URL, toLocalDevProxyUrl } from '../config/api';
import { getEnhancedWebSocketService } from '../services/websocket-enhanced';
import { enqueueLiveTick } from '../services/liveTickDispatcher';
import { getAccessToken, getServerUrl, onSessionChange } from '../services/brokerSession';
import { resolveTickFromLookup, useAppStore, type Tick as AppTick } from '../store/useAppStore';
import { type Tick, useMarketDataStore } from '../store/useMarketDataStore';
import { useWatchlistStore } from '../store/useWatchlistStore';
import { resolveDailyChangePercent } from '../utils/dailyChange';
import { isStaleQuoteErrorMessage, resolveMarketWatchSymbolInput } from '../utils/marketWatchSource';
import { useQuoteSubscription } from './useQuoteSubscription';
import type { WatchlistItem } from '../types/api';

export interface MarketInstrument {
  symbol: string;
  description?: string;
  category?: string;
  digits?: number;
  bid?: number;
  ask?: number;
  contractSize?: number;
  tradingEnabled?: boolean;
}

export interface OrderBookLevel {
  price: number;
  volume: number;
  total: number;
}

export interface LiveOrderBook {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  spread: number;
  spreadPips: number;
  timestamp: number;
}

export interface ActiveMarketSymbolsCache {
  symbols: string[];
  updatedAt: number;
  availableCount?: number;
  silentCount?: number;
}

const normalizeSymbol = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toUpperCase() : '';

const uniqueSymbols = (symbols: unknown[]): string[] =>
  Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)));

const toNumber = (value: unknown, fallback = 0): number => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

const toOptionalNumber = (value: unknown): number | undefined => {
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
};

const timestampToMs = (value: unknown): number => {
  const raw = toNumber(value, Date.now());
  return raw > 1_000_000_000_000 ? raw : raw * 1000;
};

const sourceTimestampToMs = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  return raw > 1_000_000_000_000 ? raw : raw * 1000;
};

const getSourceTickTimestamp = (raw: unknown): number | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;

  const rawRecord = raw as Record<string, unknown>;
  const dataRecord = rawRecord.data && typeof rawRecord.data === 'object'
    ? rawRecord.data as Record<string, unknown>
    : undefined;
  const payloadValue = dataRecord?.quote
    ?? dataRecord?.tick
    ?? rawRecord.data
    ?? rawRecord.quote
    ?? rawRecord.tick
    ?? rawRecord;
  const payload = payloadValue && typeof payloadValue === 'object'
    ? payloadValue as Record<string, unknown>
    : rawRecord;

  return sourceTimestampToMs(payload.timestamp ?? payload.time ?? rawRecord.timestamp);
};

const getSymbolDigits = (symbol: string): number => {
  if (symbol.includes('JPY')) return 3;
  if (symbol.startsWith('BTC') || symbol.startsWith('ETH')) return 2;
  if (symbol.startsWith('XAU') || symbol.startsWith('XAG')) return 2;
  return 5;
};

const getSpreadPips = (symbol: string, spread: number): number => {
  const digits = getSymbolDigits(symbol);
  const pipFactor = digits >= 5 ? 10000 : Math.pow(10, digits);
  return spread * pipFactor;
};

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'on', 'enabled', 'enable', 'active', 'available', 'tradable', 'trading']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'n', 'off', 'disabled', 'disable', 'inactive', 'suspended', 'halted', 'blocked', 'readonly', 'read_only', 'deleted', 'delisted', 'expired', 'close_only']);

const hasOwn = (value: unknown, key: string): boolean =>
  Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key));

const parseBooleanish = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    if (value === 0) return false;
    if (value === 1) return true;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!normalized) return undefined;
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
  }
  return undefined;
};

export const normalizeInstrumentEnabled = (raw: any): boolean | undefined => {
  const enabledKeys = ['trading_enabled', 'tradingEnabled', 'enabled', 'is_enabled', 'isEnabled'];

  for (const key of enabledKeys) {
    if (!hasOwn(raw, key)) continue;
    const parsed = parseBooleanish(raw?.[key]);
    if (parsed !== undefined) return parsed;
  }

  if (hasOwn(raw, 'status')) {
    return parseBooleanish(raw?.status);
  }

  return undefined;
};

const normalizeInstrument = (raw: any): MarketInstrument | null => {
  const symbol = normalizeSymbol(raw?.symbol ?? raw?.name ?? raw?.id ?? raw);
  if (!symbol) return null;

  return {
    symbol,
    description: raw?.description ?? raw?.display_name ?? raw?.name,
    category: raw?.category ?? raw?.asset_class ?? raw?.type,
    digits: toOptionalNumber(raw?.digits),
    bid: toOptionalNumber(raw?.bid),
    ask: toOptionalNumber(raw?.ask),
    contractSize: toOptionalNumber(raw?.contract_size ?? raw?.contractSize),
    tradingEnabled: normalizeInstrumentEnabled(raw),
  };
};

const normalizeTick = (raw: any, fallbackSymbol?: string): (Tick & Partial<AppTick>) | null => {
  const payload = raw?.data?.quote ?? raw?.data?.tick ?? raw?.data ?? raw?.quote ?? raw?.tick ?? raw;
  const symbol = normalizeSymbol(payload?.symbol ?? raw?.symbol ?? fallbackSymbol);
  if (!symbol) return null;

  const bid = toNumber(payload?.bid);
  const ask = toNumber(payload?.ask, bid);
  if (bid <= 0 && ask <= 0) return null;

  const spread = toNumber(payload?.spread, ask - bid);
  const previousClose = toNumber(payload?.previous_close ?? payload?.previousClose);
  const dailyOpen = toNumber(payload?.daily_open ?? payload?.dailyOpen ?? payload?.open);
  const session = payload?.session ?? {};
  const sessionHigh = Math.max(
    toNumber(session?.high_bid),
    toNumber(session?.high_ask),
    toNumber(payload?.high)
  );
  const sessionLowValues = [
    toNumber(session?.low_bid),
    toNumber(session?.low_ask),
    toNumber(payload?.low),
  ].filter((value) => value > 0);
  const sessionLow = sessionLowValues.length > 0 ? Math.min(...sessionLowValues) : undefined;
  const sourceTimestamp = getSourceTickTimestamp(raw);

  return {
    symbol,
    bid,
    ask,
    spread,
    timestamp: sourceTimestamp ?? timestampToMs(undefined),
    sourceTimestamp,
    lp: payload?.lp,
    volume: toNumber(payload?.volume, 1),
    dailyChange: resolveDailyChangePercent(
      payload?.dailyChange ?? payload?.daily_change,
      bid,
      previousClose,
    ),
    high24h: payload?.high24h !== undefined ? toNumber(payload.high24h) : sessionHigh || undefined,
    low24h: payload?.low24h !== undefined ? toNumber(payload.low24h) : sessionLow,
    high: payload?.high !== undefined ? toNumber(payload.high) : undefined,
    low: payload?.low !== undefined ? toNumber(payload.low) : undefined,
    open: dailyOpen || undefined,
    close: (previousClose > 0 || payload?.close !== undefined) ? toNumber(payload?.close ?? previousClose) : undefined,
  };
};

const withTotals = (levels: any[]): OrderBookLevel[] => {
  let runningTotal = 0;
  return levels
    .map((level) => {
      const price = toNumber(Array.isArray(level) ? level[0] : level?.price);
      const volume = toNumber(Array.isArray(level) ? level[1] : level?.volume);
      runningTotal += volume;
      return { price, volume, total: toNumber(level?.total, runningTotal) };
    })
    .filter((level) => level.price > 0 && level.volume >= 0);
};

export const normalizeOrderBook = (raw: any, fallbackSymbol?: string): LiveOrderBook | null => {
  const payload = raw?.data?.orderBook ?? raw?.data?.depth ?? raw?.data ?? raw?.orderBook ?? raw?.depth ?? raw;
  const symbol = normalizeSymbol(payload?.symbol ?? raw?.symbol ?? fallbackSymbol);
  const bids = withTotals(Array.isArray(payload?.bids) ? payload.bids : []);
  const asks = withTotals(Array.isArray(payload?.asks) ? payload.asks : []);
  if (!symbol || (bids.length === 0 && asks.length === 0)) return null;

  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  const spread = bestBid > 0 && bestAsk > 0 ? bestAsk - bestBid : 0;

  return {
    symbol,
    bids,
    asks,
    spread,
    spreadPips: getSpreadPips(symbol, spread),
    timestamp: timestampToMs(payload?.timestamp ?? payload?.time ?? raw?.timestamp),
  };
};

const upsertTick = (tick: Tick & Partial<AppTick>): void => {
  enqueueLiveTick(tick.symbol, tick);
};

const hasUsablePrice = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const upsertInstrumentTickSnapshot = (instrument: MarketInstrument): void => {
  if (!hasUsablePrice(instrument.bid) && !hasUsablePrice(instrument.ask)) return;

  const appState = useAppStore.getState();
  const existingTick = resolveTickFromLookup(appState.ticks, appState.tickLookup, instrument.symbol);
  if (existingTick && (existingTick.bid > 0 || existingTick.ask > 0)) return;

  const bid = hasUsablePrice(instrument.bid) ? instrument.bid : instrument.ask!;
  const ask = hasUsablePrice(instrument.ask) ? instrument.ask : instrument.bid!;

  upsertTick({
    symbol: instrument.symbol,
    bid,
    ask,
    spread: Math.max(0, ask - bid),
    timestamp: Date.now(),
    volume: 1,
    digits: instrument.digits,
  });
};

const upsertInstrumentTickSnapshots = (instruments: MarketInstrument[]): void => {
  instruments.forEach(upsertInstrumentTickSnapshot);
};

const toV2Endpoint = (endpoint: string): string =>
  endpoint.replace(/^\/api\/v2(?=\/|$)/, '') || '/';

const getApiRootBaseUrl = (): string => API_V2_BASE_URL.replace(/\/api\/v2\/?$/, '');

const resolveRestEndpoint = (endpoint: string): { baseUrl: string; endpoint: string } =>
  endpoint.startsWith('/api/v2')
    ? { baseUrl: API_V2_BASE_URL, endpoint: toV2Endpoint(endpoint) }
    : { baseUrl: getApiRootBaseUrl(), endpoint };

const fetchJson = async <T,>(endpoint: string, params?: Record<string, unknown>): Promise<T> =>
  {
    const request = resolveRestEndpoint(endpoint);
    return apiClient.get<T>(request.endpoint, { baseUrl: request.baseUrl, params });
  };

interface ApiSessionDescriptor {
  storageScopeKey: string;
  v2BaseUrl: string;
  apiRootBaseUrl: string;
  accountId: string;
}

interface CapturedApiSession extends ApiSessionDescriptor {
  runtimeKey: string;
  authToken: string | null;
  requestContext: ApiRequestContext | null;
}

let apiSessionGeneration = 0;
const apiSessionIdentities = new Map<string, {
  tokenFingerprint: string;
  v2BaseUrl: string;
  runtimeKey: string;
}>();
const apiSessionFingerprintSeed = (() => {
  const seed = new Uint32Array(2);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(seed);
  } else {
    seed[0] = Math.floor(Math.random() * 0xffffffff);
    seed[1] = Math.floor(Math.random() * 0xffffffff);
  }
  return seed;
})();

const getOpaqueSessionFingerprint = (token: string): string => {
  let left = (0x811c9dc5 ^ apiSessionFingerprintSeed[0]) >>> 0;
  let right = (0x9e3779b9 ^ apiSessionFingerprintSeed[1]) >>> 0;
  for (let index = 0; index < token.length; index += 1) {
    const code = token.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
  }
  return `${left.toString(36)}.${right.toString(36)}`;
};

const getStoredBrokerId = (): string => {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem('broker_id')
    || window.localStorage.getItem('rtx_broker_id')
    || '';
};

const getApiSessionDescriptor = (accountId: string): ApiSessionDescriptor => {
  const serverUrl = getServerUrl().replace(/\/+$/, '');
  const v2BaseUrl = serverUrl
    ? `${toLocalDevProxyUrl(serverUrl)}/api/v2`
    : API_V2_BASE_URL;
  const apiRootBaseUrl = v2BaseUrl.replace(/\/api\/v2\/?$/, '');
  const storageScopeKey = [v2BaseUrl, getStoredBrokerId(), accountId]
    .map(normalizeWatchlistScopePart)
    .join('|');
  return { storageScopeKey, v2BaseUrl, apiRootBaseUrl, accountId };
};

const captureApiSession = (
  descriptor: ApiSessionDescriptor,
  storeAuthToken: string | null,
  storeRefreshToken: string | null,
): CapturedApiSession | null => {
  const authToken = getAccessToken() || storeAuthToken;
  if (!authToken) return null;
  const refreshToken = typeof window === 'undefined'
    ? storeRefreshToken
    : window.localStorage.getItem('refresh_token')
      || window.sessionStorage.getItem('refresh_token')
      || storeRefreshToken;
  const tokenFingerprint = getOpaqueSessionFingerprint(`${authToken}\u0000${refreshToken ?? ''}`);
  const previous = apiSessionIdentities.get(descriptor.storageScopeKey);
  const runtimeKey = previous
    && previous.tokenFingerprint === tokenFingerprint
    && previous.v2BaseUrl === descriptor.v2BaseUrl
    ? previous.runtimeKey
    : `${descriptor.storageScopeKey}|session:${++apiSessionGeneration}`;

  if (!previous || previous.runtimeKey !== runtimeKey) {
    apiSessionIdentities.set(descriptor.storageScopeKey, {
      tokenFingerprint,
      v2BaseUrl: descriptor.v2BaseUrl,
      runtimeKey,
    });
  }

  return {
    ...descriptor,
    runtimeKey,
    authToken,
    requestContext: Object.freeze({
      key: runtimeKey,
      backendOrigin: descriptor.apiRootBaseUrl,
      refreshEndpoint: `${descriptor.v2BaseUrl}/auth/refresh`,
      refreshToken,
    }),
  };
};

const getCapturedRequestOptions = (
  session: CapturedApiSession,
  baseUrl: string,
  signal?: AbortSignal,
): ApiRequestOptions => {
  if (!session.authToken || !session.requestContext) {
    throw new ApiError(401, 'Captured API session is no longer active');
  }
  return {
    baseUrl,
    authToken: session.authToken,
    requestContext: session.requestContext,
    skipDynamicUrl: true,
    signal,
  };
};

const useBrokerSessionRevision = (): number => {
  const [revision, setRevision] = useState(0);
  useEffect(() => onSessionChange(() => setRevision((current) => current + 1)), []);
  return revision;
};

const sameSymbols = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((symbol, index) => symbol === b[index]);

export const MARKET_SYMBOLS_STALE_EVENT = 'rtx:market-symbols-stale';

interface MarketSymbolsStaleEventDetail {
  symbols: string[];
}

export interface StaleQuoteFailure {
  isStale: boolean;
  symbols: string[];
}

const collectErrorStrings = (value: unknown, strings: string[], visited: Set<object>): void => {
  if (typeof value === 'string') {
    strings.push(value);
    return;
  }
  if (!value || typeof value !== 'object' || visited.has(value)) return;

  visited.add(value);
  if (value instanceof Error) strings.push(value.message);

  const record = value as Record<string, unknown>;
  for (const key of ['message', 'detail', 'error', 'code', 'reason', 'symbol', 'symbols', 'data']) {
    const nested = record[key];
    if (Array.isArray(nested)) {
      nested.forEach((item) => collectErrorStrings(item, strings, visited));
    } else {
      collectErrorStrings(nested, strings, visited);
    }
  }
};

const REGEXP_SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/g;
const SYMBOL_TOKEN_CHARACTER_CLASS = 'A-Z0-9._#:/+\\-';

const containsExactSymbolToken = (value: string, symbol: string): boolean => {
  const escapedSymbol = symbol.replace(REGEXP_SPECIAL_CHARACTERS, '\\$&');
  return new RegExp(
    `(^|[^${SYMBOL_TOKEN_CHARACTER_CLASS}])${escapedSymbol}(?=$|[^${SYMBOL_TOKEN_CHARACTER_CLASS}])`,
  ).test(value);
};

export const getStaleQuoteFailure = (
  error: unknown,
  requestedSymbols: readonly string[],
): StaleQuoteFailure => {
  const requested = uniqueSymbols([...requestedSymbols]);
  const strings: string[] = [];
  collectErrorStrings(error, strings, new Set<object>());
  const isStale = strings.some(isStaleQuoteErrorMessage);
  if (!isStale) return { isStale: false, symbols: [] };

  // Match symbols only in the strings that actually describe the stale
  // failure. Some error payloads echo the whole requested batch separately;
  // using those values would incorrectly evict healthy neighbours.
  const normalizedDetails = strings
    .filter(isStaleQuoteErrorMessage)
    .map((value) => value.toUpperCase());
  const matchedSymbols = requested.filter((symbol) =>
    normalizedDetails.some((value) => containsExactSymbolToken(value, symbol))
  );

  return {
    isStale: true,
    symbols: matchedSymbols.length > 0
      ? matchedSymbols
      : requested.length === 1
        ? requested
        : [],
  };
};

const dispatchStaleMarketSymbols = (symbols: readonly string[]): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<MarketSymbolsStaleEventDetail>(MARKET_SYMBOLS_STALE_EVENT, {
    detail: { symbols: uniqueSymbols([...symbols]) },
  }));
};

export const ACTIVE_MARKET_SYMBOLS_STORAGE_KEY_PREFIX = 'rtx5-active-market-symbols:v1';

const getBrowserLocalStorage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

const normalizeStorageScope = (value: unknown): string => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'default';
};

const getActiveMarketSymbolsStorageScope = (): string => {
  const storage = getBrowserLocalStorage();
  const brokerId = storage?.getItem('broker_id') || storage?.getItem('rtx_broker_id');
  if (brokerId) return normalizeStorageScope(brokerId);

  const serverUrl = getServerUrl();
  if (!serverUrl) return 'default';

  try {
    return normalizeStorageScope(new URL(serverUrl).hostname);
  } catch {
    return normalizeStorageScope(serverUrl);
  }
};

export const getActiveMarketSymbolsStorageKey = (scope?: string): string =>
  `${ACTIVE_MARKET_SYMBOLS_STORAGE_KEY_PREFIX}:${normalizeStorageScope(scope || getActiveMarketSymbolsStorageScope())}`;

const extractSymbolList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return uniqueSymbols(value.map((item) => {
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    if (!item || typeof item !== 'object') return '';
    const record = item as Record<string, unknown>;
    return String(record.symbol ?? record.name ?? record.id ?? '');
  }));
};

const hasPositiveQuoteValue = (value: unknown): boolean => toNumber(value) > 0;

const STALE_QUOTE_STATES = new Set([
  'stale',
  'silent',
  'no_data',
  'no_quote',
  'quote_stale',
  'unavailable',
]);

const normalizeStatusValue = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';

const rowHasLiveMarketData = (row: Record<string, unknown>): boolean => {
  const hasData = parseBooleanish(row?.has_data ?? row?.hasData);
  if (hasData === false) return false;

  const hasQuote = parseBooleanish(row?.has_quote ?? row?.hasQuote);
  if (hasQuote === false) return false;

  const fresh = parseBooleanish(row?.fresh ?? row?.is_fresh ?? row?.isFresh);
  if (fresh === false) return false;

  const stale = parseBooleanish(row?.stale ?? row?.is_stale ?? row?.isStale);
  if (stale === true) return false;

  const quoteStatus = normalizeStatusValue(
    row?.quote_status ?? row?.quoteStatus ?? row?.feed_status ?? row?.feedStatus ?? row?.status
  );
  if (STALE_QUOTE_STATES.has(quoteStatus)) return false;

  const age = toOptionalNumber(row?.last_tick_age_sec ?? row?.lastTickAgeSec ?? row?.age_sec ?? row?.ageSec);
  if (age !== undefined) return age >= 0 && age <= 90;

  // Respect fresh ticks from WS data by checking timestamp age
  const tickTimestamp = sourceTimestampToMs(
    row?.timestamp ?? row?.time ?? row?.last_tick_time ?? row?.lastTickTime ?? row?.tick_timestamp,
  );
  if (tickTimestamp !== undefined) {
    const tickAge = (Date.now() - tickTimestamp) / 1000;
    if (tickAge > 300 || tickAge < 0) return false;
  }

  const silent = parseBooleanish(row?.silent);
  if (silent !== undefined) return silent === false;

  const time = toOptionalNumber(row?.time ?? row?.timestamp ?? row?.last_tick_time ?? row?.lastTickTime);
  if (time !== undefined && time <= 0) return false;

  if (hasQuote === true) return true;
  return hasPositiveQuoteValue(row?.bid) || hasPositiveQuoteValue(row?.ask);
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? value as Record<string, unknown> : {};

export const hasAuthoritativeMarketSymbolStatus = (response: unknown): boolean => {
  const record = asRecord(response);
  return Array.isArray(record.symbol_status)
    || (Array.isArray(record.available_symbols) && Array.isArray(record.silent_symbols));
};

export const extractActiveMarketSymbols = (response: unknown): string[] => {
  const record = asRecord(response);
  const hasStatusRows = Array.isArray(record.symbol_status);
  const statusRows = hasStatusRows ? record.symbol_status as unknown[] : [];
  const activeFromStatus = uniqueSymbols(statusRows
    .map(asRecord)
    .filter((row) => {
      const symbol = normalizeSymbol(row.symbol ?? row.name ?? row.id);
      if (!symbol) return false;
      return rowHasLiveMarketData(row);
    })
    .map((row) => row.symbol ?? row.name ?? row.id));

  // Per-symbol rows are the canonical freshness source. An empty result is an
  // authoritative "zero fresh symbols" response and must never fall through
  // to a broader availability list that can contain stale quotes.
  if (hasStatusRows) {
    return activeFromStatus;
  }

  const available = extractSymbolList(record.available_symbols ?? record.symbols ?? record.data);
  const hasSilentList = Array.isArray(record.silent_symbols);
  const silent = new Set(extractSymbolList(record.silent_symbols));

  if (available.length > 0 && hasSilentList) {
    return available.filter((symbol) => !silent.has(symbol));
  }

  return activeFromStatus;
};

export const readCachedActiveMarketSymbols = (scope?: string): ActiveMarketSymbolsCache => {
  const storage = getBrowserLocalStorage();
  if (!storage) return { symbols: [], updatedAt: 0 };

  try {
    const raw = storage.getItem(getActiveMarketSymbolsStorageKey(scope));
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      symbols: extractSymbolList(parsed?.symbols),
      updatedAt: toNumber(parsed?.updatedAt),
      availableCount: toOptionalNumber(parsed?.availableCount),
      silentCount: toOptionalNumber(parsed?.silentCount),
    };
  } catch {
    return { symbols: [], updatedAt: 0 };
  }
};

const writeCachedActiveMarketSymbols = (cache: ActiveMarketSymbolsCache, scope?: string): void => {
  const storage = getBrowserLocalStorage();
  if (!storage) return;

  try {
    storage.setItem(getActiveMarketSymbolsStorageKey(scope), JSON.stringify({
      ...cache,
      symbols: uniqueSymbols(cache.symbols),
    }));
  } catch {
    // Browser storage can be unavailable or full; live status still drives this session.
  }
};

export const LIVE_QUOTES_REST_BATCH_SIZE = 50;
export const LIVE_QUOTES_REST_POLL_INTERVAL_MS = 15000;
export const ACTIVE_MARKET_SYMBOLS_REFRESH_INTERVAL_MS = 30000;

export const getLiveQuoteRestBatches = (
  symbols: string[],
  batchSize = LIVE_QUOTES_REST_BATCH_SIZE
): string[][] => {
  const size = Math.max(1, Math.floor(batchSize));
  const batches: string[][] = [];

  for (let index = 0; index < symbols.length; index += size) {
    batches.push(symbols.slice(index, index + size));
  }

  return batches;
};

const extractInstrumentRows = (response: any): any[] => {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.symbols)) return response.symbols;
  if (Array.isArray(response?.instruments)) return response.instruments;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.result)) return response.result;
  return [];
};

export function useActiveMarketSymbols() {
  // Do not paint a cached symbol before its current feed freshness has been
  // verified. The cache remains a network-failure fallback only.
  const [symbols, setSymbols] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [settled, setSettled] = useState(false);
  const [current, setCurrent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);

  const reload = useCallback(async () => {
    const requestGeneration = ++requestGenerationRef.current;
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get<any>('/ws/feed/status', {
        baseUrl: getApiRootBaseUrl(),
        skipAuth: true,
        skipDynamicUrl: true,
      });
      if (requestGeneration !== requestGenerationRef.current) return;
      const nextSymbols = extractActiveMarketSymbols(response);

      if (nextSymbols.length > 0 || hasAuthoritativeMarketSymbolStatus(response)) {
        writeCachedActiveMarketSymbols({
          symbols: nextSymbols,
          updatedAt: Date.now(),
          availableCount: toOptionalNumber(response?.available_symbols?.length),
          silentCount: toOptionalNumber(response?.silent_symbols?.length),
        });
        setSymbols(nextSymbols);
        setCurrent(true);
        return;
      }

      const cached = readCachedActiveMarketSymbols();
      setSymbols(cached.symbols);
      setCurrent(false);
      setError('No active feed symbols returned');
    } catch (err) {
      if (requestGeneration !== requestGenerationRef.current) return;
      const cached = readCachedActiveMarketSymbols();
      setSymbols(cached.symbols);
      setCurrent(false);
      setError(err instanceof ApiError ? err.message : 'Failed to load active feed symbols');
    } finally {
      if (requestGeneration === requestGenerationRef.current) {
        setSettled(true);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const handleStaleSymbols = (event: Event) => {
      const detail = (event as CustomEvent<MarketSymbolsStaleEventDetail>).detail;
      const staleSymbols = uniqueSymbols(detail?.symbols ?? []);

      if (staleSymbols.length > 0) {
        const staleSet = new Set(staleSymbols);
        setSymbols((current) => current.filter((symbol) => !staleSet.has(symbol)));
        const cached = readCachedActiveMarketSymbols();
        writeCachedActiveMarketSymbols({
          ...cached,
          symbols: cached.symbols.filter((symbol) => !staleSet.has(symbol)),
          updatedAt: Date.now(),
        });
      }

      void reload();
    };

    window.addEventListener(MARKET_SYMBOLS_STALE_EVENT, handleStaleSymbols);
    void reload();
    const interval = window.setInterval(() => {
      if (!cancelled) void reload();
    }, ACTIVE_MARKET_SYMBOLS_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      requestGenerationRef.current += 1;
      window.clearInterval(interval);
      window.removeEventListener(MARKET_SYMBOLS_STALE_EVENT, handleStaleSymbols);
    };
  }, [reload]);

  return { symbols, loading, settled, current, error, reload };
}

export function useMarketInstruments() {
  const [symbols, setSymbols] = useState<MarketInstrument[]>([]);
  const [disabledSymbols, setDisabledSymbols] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isAuthenticated = useAppStore((state) => state.isAuthenticated);
  const accountId = useAppStore((state) => state.accountId);
  const storeAuthToken = useAppStore((state) => state.authToken);
  const storeRefreshToken = useAppStore((state) => state.refreshToken);
  const sessionRevision = useBrokerSessionRevision();
  const requestGenerationRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const sessionDescriptor = useMemo(
    () => isAuthenticated && accountId
      ? getApiSessionDescriptor(accountId)
      : null,
    [accountId, isAuthenticated, sessionRevision],
  );
  const requestSession = useMemo(
    () => sessionDescriptor
      ? captureApiSession(sessionDescriptor, storeAuthToken, storeRefreshToken)
      : null,
    [sessionDescriptor, storeAuthToken, storeRefreshToken],
  );

  const reload = useCallback(async () => {
    const requestGeneration = ++requestGenerationRef.current;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;

    if (!isAuthenticated || !requestSession) {
      setSymbols([]);
      setDisabledSymbols([]);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    requestAbortRef.current = controller;
    setLoading(true);
    setError(null);

    const endpoints = ['/api/v2/instruments', '/api/v1/market/symbols', '/api/v1/market/symbol-list'];
    try {
      for (const endpoint of endpoints) {
        try {
          const request = endpoint.startsWith('/api/v2')
            ? {
              endpoint: toV2Endpoint(endpoint),
              baseUrl: requestSession.v2BaseUrl,
            }
            : {
              endpoint,
              baseUrl: requestSession.apiRootBaseUrl,
            };
          const response = await apiClient.get<unknown>(
            request.endpoint,
            getCapturedRequestOptions(requestSession, request.baseUrl, controller.signal),
          );
          if (requestGeneration !== requestGenerationRef.current || controller.signal.aborted) return;
          const raw = extractInstrumentRows(response);
          const normalized = raw.map(normalizeInstrument).filter(Boolean) as MarketInstrument[];
          if (normalized.length > 0) {
            const disabled = normalized
              .filter((instrument) => instrument.tradingEnabled === false)
              .map((instrument) => instrument.symbol);
            const next = normalized.filter((instrument) => instrument.tradingEnabled !== false);
            const watchlistScope = remoteWatchlistScopes.get(requestSession.runtimeKey);
            if (watchlistScope) {
              watchlistScope.catalogSymbols =
                normalizeWatchlistSymbols(normalized.map((instrument) => instrument.symbol));
            }
            setDisabledSymbols(disabled);
            setSymbols(next);
            upsertInstrumentTickSnapshots(next);
            return;
          }
        } catch (err) {
          if (requestGeneration !== requestGenerationRef.current || controller.signal.aborted) return;
          if (endpoint === endpoints[endpoints.length - 1]) {
            setError(err instanceof ApiError ? err.message : 'Failed to load symbols');
          }
        }
      }

      setSymbols([]);
      setDisabledSymbols([]);
    } finally {
      if (requestGeneration === requestGenerationRef.current && !controller.signal.aborted) {
        requestAbortRef.current = null;
        setLoading(false);
      }
    }
  }, [isAuthenticated, requestSession]);

  useEffect(() => {
    void reload();
    return () => {
      requestGenerationRef.current += 1;
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
    };
  }, [reload]);

  return { symbols, disabledSymbols, loading, error, reload };
}

export function useLiveQuotes(symbols: string[]) {
  const normalizedSymbols = useMemo(
    () => Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean))),
    [symbols.join('|')]
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const failureRef = useRef<{
    symbols: string[];
    isStale: boolean;
    tickTimestampsAtFailure: Record<string, number>;
  } | null>(null);
  const isAuthenticated = useAppStore((state) => state.isAuthenticated);

  // Section 2: Use QuoteSocketManager via useQuoteSubscription for /ws/feed
  useQuoteSubscription(normalizedSymbols, 'live-quotes');

  // REST polling fallback (still needed for initial quote snapshot)
  useEffect(() => {
    if (!isAuthenticated) {
      failureRef.current = null;
      setError(null);
      return;
    }

    if (normalizedSymbols.length === 0) {
      if (!failureRef.current?.isStale) {
        failureRef.current = null;
        setError(null);
      }
      return;
    }

    const previousFailure = failureRef.current;
    if (
      previousFailure
      && !previousFailure.isStale
      && !previousFailure.symbols.some((symbol) => normalizedSymbols.includes(symbol))
    ) {
      failureRef.current = null;
      setError(null);
    }

    let cancelled = false;
    let batchIndex = 0;
    let inFlight = false;
    const batches = getLiveQuoteRestBatches(normalizedSymbols);

    const loadNextQuoteBatch = async () => {
      if (cancelled || inFlight || batches.length === 0) return;
      const batch = batches[batchIndex % batches.length];
      batchIndex = (batchIndex + 1) % batches.length;

      inFlight = true;
      setLoading(true);
      try {
        const response = await fetchJson<any>('/api/v2/quotes', {
          symbols: batch.join(','),
        });
        if (cancelled) return;

        const quotes = Array.isArray(response) ? response : response?.quotes ?? [];
        const failureAtResponse = failureRef.current;
        const recoveredSymbols = new Set<string>();
        const recoveryTimestamps = new Map<string, number>();
        quotes.forEach((quote: any) => {
          const tick = normalizeTick(quote);
          if (tick) {
            recoveredSymbols.add(tick.symbol);
            const sourceTimestamp = getSourceTickTimestamp(quote);
            if (sourceTimestamp !== undefined) {
              recoveryTimestamps.set(tick.symbol, sourceTimestamp);
            }

            // A timestamp-less REST row may still update prices, but it cannot
            // masquerade as a fresh websocket tick after a stale-symbol error.
            // Preserve the failure-time timestamp until either REST supplies an
            // authoritative newer value or an actual newer live tick arrives.
            const failureTimestamp = failureAtResponse?.isStale
              && failureAtResponse.symbols.includes(tick.symbol)
              && sourceTimestamp === undefined
              ? failureAtResponse.tickTimestampsAtFailure[tick.symbol] ?? 0
              : undefined;
            upsertTick(failureTimestamp === undefined
              ? tick
              : { ...tick, timestamp: failureTimestamp });
          }
        });

        const failure = failureRef.current;
        const allFailedSymbolsRecovered = failure?.symbols.every((symbol) => {
          if (!recoveredSymbols.has(symbol)) return false;
          if (!failure.isStale) return true;

          const recoveryTimestamp = recoveryTimestamps.get(symbol);
          return recoveryTimestamp !== undefined
            && recoveryTimestamp > (failure.tickTimestampsAtFailure[symbol] ?? 0);
        });
        if (failure && failure.symbols.length > 0 && allFailedSymbolsRecovered) {
          failureRef.current = null;
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          const staleFailure = getStaleQuoteFailure(err, batch);
          const failedSymbols = staleFailure.symbols.length > 0
            ? staleFailure.symbols
            : batch;
          const symbolData = useMarketDataStore.getState().symbolData;
          failureRef.current = {
            symbols: uniqueSymbols(failedSymbols),
            isStale: staleFailure.isStale,
            tickTimestampsAtFailure: Object.fromEntries(
              uniqueSymbols(failedSymbols).map((symbol) => [
                symbol,
                symbolData[symbol]?.currentTick?.sourceTimestamp
                  ?? symbolData[symbol]?.currentTick?.timestamp
                  ?? 0,
              ]),
            ),
          };
          if (staleFailure.isStale) dispatchStaleMarketSymbols(staleFailure.symbols);
          setError(err instanceof ApiError ? err.message : 'Failed to load quotes');
        }
      } finally {
        inFlight = false;
        if (!cancelled) setLoading(false);
      }
    };

    void loadNextQuoteBatch();
    const interval = window.setInterval(() => {
      void loadNextQuoteBatch();
    }, LIVE_QUOTES_REST_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [normalizedSymbols.join('|'), isAuthenticated]);

  // Subscribe in MarketDataStore for aggregation tracking
  useEffect(() => {
    if (normalizedSymbols.length === 0 || !isAuthenticated) return;

    normalizedSymbols.forEach((symbol) => {
      useMarketDataStore.getState().subscribeSymbol(symbol);
    });

    return () => {
      normalizedSymbols.forEach((symbol) => {
        useMarketDataStore.getState().unsubscribeSymbol(symbol);
      });
    };
  }, [normalizedSymbols.join('|'), isAuthenticated]);

  // Clear a stale failure only after every failed symbol receives a fresh
  // websocket tick. Healthy ticks for other symbols must not hide the failure.
  useEffect(() => {
    if (normalizedSymbols.length === 0 || !isAuthenticated) return;

    const unsub = useMarketDataStore.subscribe((state) => {
      const failure = failureRef.current;
      if (!failure?.isStale || failure.symbols.length === 0) return;

      const now = Date.now();
      const failedSymbolsInScope = failure.symbols.filter((symbol) => normalizedSymbols.includes(symbol));
      if (failedSymbolsInScope.length !== failure.symbols.length) return;

      const allFailedSymbolsRecovered = failedSymbolsInScope.every((symbol) => {
        const tick = state.symbolData[symbol]?.currentTick;
        const sourceTimestamp = tick?.sourceTimestamp;
        return Boolean(
          tick
          && tick.bid > 0
          && tick.ask > 0
          && sourceTimestamp !== undefined
          && sourceTimestamp > now - 60000
          && sourceTimestamp > (failure.tickTimestampsAtFailure[symbol] ?? 0)
        );
      });

      if (allFailedSymbolsRecovered && failureRef.current === failure) {
        failureRef.current = null;
        setError(null);
      }
    });

    return unsub;
  }, [normalizedSymbols.join('|'), isAuthenticated]);

  return { loading, error };
}

export function useLiveOrderBook(symbol: string, depth: number) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const [orderBook, setOrderBook] = useState<LiveOrderBook | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAuthenticated = useAppStore((state) => state.isAuthenticated);
  const authToken = useAppStore((state) => state.authToken);

  const reload = useCallback(async () => {
    if (!normalizedSymbol || !isAuthenticated) {
      setOrderBook(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetchJson<any>(`/api/v2/depth/${encodeURIComponent(normalizedSymbol)}`, {
        limit: depth,
      });
      const next = normalizeOrderBook(response, normalizedSymbol);
      setOrderBook(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load order book');
      setOrderBook(null);
    } finally {
      setLoading(false);
    }
  }, [normalizedSymbol, depth, isAuthenticated]);

  useEffect(() => {
    reload();
    const interval = window.setInterval(reload, 15000);
    return () => window.clearInterval(interval);
  }, [reload]);

  useEffect(() => {
    if (!normalizedSymbol || !isAuthenticated) return;

    const ws = getEnhancedWebSocketService(MARKET_WS_URL);
    ws.connect();
    const channel = `depth.${normalizedSymbol}`;
    const unsubscribe = ws.subscribe(channel, (message) => {
      const next = normalizeOrderBook(message, normalizedSymbol);
      if (next) setOrderBook(next);
    });

    return () => {
      unsubscribe();
    };
  }, [normalizedSymbol, isAuthenticated, authToken]);

  return { orderBook, loading, error, reload };
}

type RemoteWatchlistPhase = 'idle' | 'loading' | 'hydrated' | 'failed';

type WatchlistOperation =
  | { type: 'add'; symbol: string; index: number }
  | { type: 'remove'; symbol: string }
  | { type: 'move'; symbol: string; index: number };

interface RemoteWatchlistScope {
  key: string;
  storageScopeKey: string;
  session: CapturedApiSession;
  abortController: AbortController;
  phase: RemoteWatchlistPhase;
  revision: number;
  hydrationGeneration: number;
  hydrationPromise: Promise<void> | null;
  hydrationObserved: string[];
  hydrationOperations: WatchlistOperation[];
  confirmedSymbols: string[] | null;
  desiredSymbols: string[] | null;
  writeInFlight: boolean;
  writePromise: Promise<void> | null;
  writeGeneration: number;
  protectAcknowledgedOnNextHydration: boolean;
  saveTimer: number | null;
  activeBindings: number;
  lifecycleGeneration: number;
  catalogSymbols: string[];
  listeners: Set<() => void>;
  error: string | null;
}

interface PendingWatchlistState {
  desiredSymbols: string[] | null;
  hydrationOperations: WatchlistOperation[];
}

const REMOTE_WATCHLIST_SAVE_DELAY_MS = 500;
const REMOTE_WATCHLIST_PENDING_PREFIX = 'rtx5-watchlist-pending:v1:';
const remoteWatchlistScopes = new Map<string, RemoteWatchlistScope>();
const normalizeWatchlistSymbols = (symbols: readonly unknown[], catalog: readonly string[] = []): string[] =>
  uniqueSymbols([...symbols]).map((symbol) => resolveMarketWatchSymbolInput(catalog, symbol) ?? symbol);

const getPendingWatchlistStorageKey = (scopeKey: string): string =>
  `${REMOTE_WATCHLIST_PENDING_PREFIX}${encodeURIComponent(scopeKey)}`;

const parsePendingWatchlistOperations = (value: unknown): WatchlistOperation[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): WatchlistOperation[] => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const symbol = normalizeSymbol(record.symbol);
    if (!symbol) return [];
    if (record.type === 'remove') return [{ type: 'remove', symbol }];
    const index = Number(record.index);
    if (!Number.isInteger(index) || index < 0) return [];
    if (record.type === 'add' || record.type === 'move') {
      return [{ type: record.type, symbol, index }];
    }
    return [];
  });
};

const readPendingWatchlist = (scopeKey: string): PendingWatchlistState => {
  try {
    const raw = window.localStorage.getItem(getPendingWatchlistStorageKey(scopeKey));
    if (!raw) return { desiredSymbols: null, hydrationOperations: [] };
    const parsed: unknown = JSON.parse(raw);
    // Backward compatibility for snapshots written before the operation
    // journal was introduced.
    if (Array.isArray(parsed)) {
      return {
        desiredSymbols: normalizeWatchlistSymbols(parsed),
        hydrationOperations: [],
      };
    }
    if (!parsed || typeof parsed !== 'object') {
      return { desiredSymbols: null, hydrationOperations: [] };
    }
    const record = parsed as Record<string, unknown>;
    return {
      desiredSymbols: Array.isArray(record.desiredSymbols)
        ? normalizeWatchlistSymbols(record.desiredSymbols)
        : null,
      hydrationOperations: parsePendingWatchlistOperations(record.hydrationOperations),
    };
  } catch {
    return { desiredSymbols: null, hydrationOperations: [] };
  }
};

const persistPendingWatchlist = (scope: RemoteWatchlistScope): void => {
  try {
    const key = getPendingWatchlistStorageKey(scope.storageScopeKey);
    if (scope.desiredSymbols || scope.hydrationOperations.length > 0) {
      const pending: PendingWatchlistState = {
        desiredSymbols: scope.desiredSymbols,
        hydrationOperations: scope.hydrationOperations,
      };
      window.localStorage.setItem(key, JSON.stringify(pending));
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Durable recovery is best-effort; the in-memory intent remains authoritative.
  }
};

const parseRemoteWatchlist = (payload: unknown, catalog: readonly string[]): string[] => {
  if (!Array.isArray(payload)) throw new ApiError(0, 'Invalid watchlist response: expected an array');
  const rows = payload.map((item, index) => {
    if (!item || typeof item !== 'object') throw new ApiError(0, 'Invalid watchlist response item');
    const record = item as Record<string, unknown>;
    const symbol = normalizeSymbol(record.symbol);
    const order = record.sort_order === undefined || record.sort_order === null
      ? index
      : Number(record.sort_order);
    if (!symbol || !Number.isInteger(order) || order < 0) {
      throw new ApiError(0, 'Invalid watchlist response item');
    }
    return { symbol, order, index };
  });
  rows.sort((left, right) => left.order - right.order || left.index - right.index);
  return normalizeWatchlistSymbols(rows.map(({ symbol }) => symbol), catalog);
};

const normalizeWatchlistScopePart = (value: unknown): string =>
  String(value ?? '').trim().toLowerCase().replace(/\/+$/, '') || 'default';

const getRemoteWatchlistScope = (session: CapturedApiSession): RemoteWatchlistScope => {
  const existing = remoteWatchlistScopes.get(session.runtimeKey);
  if (existing) return existing;
  const pending = typeof window === 'undefined'
    ? { desiredSymbols: null, hydrationOperations: [] }
    : readPendingWatchlist(session.storageScopeKey);
  const created: RemoteWatchlistScope = {
    key: session.runtimeKey,
    storageScopeKey: session.storageScopeKey,
    session,
    abortController: new AbortController(),
    phase: 'idle', revision: 0, hydrationGeneration: 0, hydrationPromise: null,
    hydrationObserved: [], hydrationOperations: pending.hydrationOperations,
    confirmedSymbols: null, desiredSymbols: pending.desiredSymbols,
    writeInFlight: false, writePromise: null, writeGeneration: 0, saveTimer: null,
    protectAcknowledgedOnNextHydration: false,
    activeBindings: 0, lifecycleGeneration: 0, catalogSymbols: [], listeners: new Set(), error: null,
  };
  remoteWatchlistScopes.set(session.runtimeKey, created);
  return created;
};

const notifyRemoteWatchlistScope = (scope: RemoteWatchlistScope): void => {
  scope.revision += 1;
  scope.listeners.forEach((listener) => listener());
};

const getWatchlistErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const deriveWatchlistOperations = (previous: string[], next: string[]): WatchlistOperation[] => {
  const operations: WatchlistOperation[] = [];
  const working = [...previous];
  for (const symbol of previous) {
    if (!next.includes(symbol)) {
      operations.push({ type: 'remove', symbol });
      working.splice(working.indexOf(symbol), 1);
    }
  }
  next.forEach((symbol, index) => {
    const currentIndex = working.indexOf(symbol);
    if (currentIndex < 0) {
      operations.push({ type: 'add', symbol, index });
      working.splice(index, 0, symbol);
    } else if (currentIndex !== index) {
      operations.push({ type: 'move', symbol, index });
      working.splice(currentIndex, 1);
      working.splice(index, 0, symbol);
    }
  });
  return operations;
};

const applyWatchlistOperations = (remote: string[], operations: WatchlistOperation[]): string[] => {
  const result = [...remote];
  operations.forEach((operation) => {
    const currentIndex = result.indexOf(operation.symbol);
    if (operation.type === 'remove') {
      if (currentIndex >= 0) result.splice(currentIndex, 1);
      return;
    }
    if (currentIndex >= 0) result.splice(currentIndex, 1);
    result.splice(Math.min(operation.index, result.length), 0, operation.symbol);
  });
  return result;
};

const flushRemoteWatchlist = async (scope: RemoteWatchlistScope): Promise<void> => {
  if (
    scope.abortController.signal.aborted
    || scope.phase !== 'hydrated'
    || scope.activeBindings === 0
    || scope.writeInFlight
    || !scope.desiredSymbols
  ) return;
  const sentSymbols = [...scope.desiredSymbols];
  const generation = ++scope.writeGeneration;
  const lifecycleGeneration = scope.lifecycleGeneration;
  scope.writeInFlight = true;
  scope.error = null;
  notifyRemoteWatchlistScope(scope);
  try {
    await watchlistV2Api.update(sentSymbols, getCapturedRequestOptions(
      scope.session,
      scope.session.v2BaseUrl,
      scope.abortController.signal,
    ));
    if (generation !== scope.writeGeneration || lifecycleGeneration !== scope.lifecycleGeneration) return;
    scope.confirmedSymbols = sentSymbols;
    scope.protectAcknowledgedOnNextHydration = true;
    if (scope.desiredSymbols && sameSymbols(scope.desiredSymbols, sentSymbols)) scope.desiredSymbols = null;
    persistPendingWatchlist(scope);
  } catch (error) {
    if (generation !== scope.writeGeneration || lifecycleGeneration !== scope.lifecycleGeneration) return;
    if (scope.abortController.signal.aborted) return;
    console.warn('[Watchlist Sync] Failed to save remote watchlist:', error);
    scope.error = getWatchlistErrorMessage(error, 'Failed to save watchlist');
  } finally {
    if (generation === scope.writeGeneration) {
      scope.writeInFlight = false;
      scope.writePromise = null;
      notifyRemoteWatchlistScope(scope);
      if (scope.activeBindings > 0 && scope.desiredSymbols && !sameSymbols(scope.desiredSymbols, sentSymbols)) {
        scope.writePromise = flushRemoteWatchlist(scope);
      }
    }
  }
};

const scheduleRemoteWatchlistSave = (scope: RemoteWatchlistScope): void => {
  if (scope.phase !== 'hydrated' || scope.activeBindings === 0 || scope.writeInFlight || !scope.desiredSymbols) return;
  if (scope.saveTimer !== null) window.clearTimeout(scope.saveTimer);
  const generation = scope.writeGeneration;
  const lifecycleGeneration = scope.lifecycleGeneration;
  scope.saveTimer = window.setTimeout(() => {
    scope.saveTimer = null;
    if (
      generation === scope.writeGeneration
      && lifecycleGeneration === scope.lifecycleGeneration
      && scope.activeBindings > 0
    ) {
      scope.writePromise = flushRemoteWatchlist(scope);
    }
  }, REMOTE_WATCHLIST_SAVE_DELAY_MS);
};

const hydrateRemoteWatchlist = (
  scope: RemoteWatchlistScope,
  localSymbols: string[],
  force: boolean,
): Promise<void> => {
  if (scope.abortController.signal.aborted || scope.activeBindings === 0) return Promise.resolve();
  if (force && scope.writePromise) {
    return scope.writePromise.then(() => (
      scope.abortController.signal.aborted || scope.activeBindings === 0
        ? undefined
        : hydrateRemoteWatchlist(scope, localSymbols, true)
    ));
  }
  if (scope.phase === 'loading' && scope.hydrationPromise) return scope.hydrationPromise;
  if (!force && scope.phase === 'hydrated') {
    scheduleRemoteWatchlistSave(scope);
    return Promise.resolve();
  }
  if (scope.phase === 'idle' || scope.phase === 'hydrated') {
    scope.hydrationObserved = [...localSymbols];
  }
  const generation = ++scope.hydrationGeneration;
  const acknowledgedSymbols = force && scope.protectAcknowledgedOnNextHydration
    ? scope.confirmedSymbols
    : null;
  scope.phase = 'loading';
  scope.error = null;
  notifyRemoteWatchlistScope(scope);
  const request = watchlistV2Api.list(getCapturedRequestOptions(
    scope.session,
    scope.session.v2BaseUrl,
    scope.abortController.signal,
  ))
    .then((response: WatchlistItem[]) => {
      if (generation !== scope.hydrationGeneration || scope.abortController.signal.aborted) return;
      const remoteSymbols = parseRemoteWatchlist(response, scope.catalogSymbols);
      const intended = scope.desiredSymbols
        ?? (scope.hydrationOperations.length > 0
          ? applyWatchlistOperations(remoteSymbols, scope.hydrationOperations)
          : acknowledgedSymbols ?? remoteSymbols);
      scope.protectAcknowledgedOnNextHydration = false;
      scope.confirmedSymbols = remoteSymbols;
      scope.desiredSymbols = sameSymbols(intended, remoteSymbols) ? null : intended;
      scope.hydrationOperations = [];
      scope.hydrationObserved = [...intended];
      persistPendingWatchlist(scope);
      scope.phase = 'hydrated';
      scope.error = null;
      notifyRemoteWatchlistScope(scope);
      scheduleRemoteWatchlistSave(scope);
    })
    .catch((error: unknown) => {
      if (generation !== scope.hydrationGeneration) return;
      if (scope.abortController.signal.aborted) return;
      console.warn('[Watchlist Sync] Failed to load remote watchlist:', error);
      scope.phase = 'failed';
      scope.error = getWatchlistErrorMessage(error, 'Failed to load watchlist');
      notifyRemoteWatchlistScope(scope);
    })
    .finally(() => {
      if (generation === scope.hydrationGeneration) scope.hydrationPromise = null;
    });
  scope.hydrationPromise = request;
  return request;
};

const recordLocalWatchlistSnapshot = (scope: RemoteWatchlistScope, symbols: string[]): void => {
  if (scope.phase === 'loading' || scope.phase === 'failed') {
    if (scope.desiredSymbols) {
      scope.desiredSymbols = [...symbols];
      persistPendingWatchlist(scope);
    } else {
      scope.hydrationOperations.push(...deriveWatchlistOperations(scope.hydrationObserved, symbols));
      scope.hydrationObserved = [...symbols];
      persistPendingWatchlist(scope);
    }
    return;
  }
  if (scope.phase !== 'hydrated' || !scope.confirmedSymbols) return;
  scope.desiredSymbols = sameSymbols(symbols, scope.confirmedSymbols) ? null : [...symbols];
  persistPendingWatchlist(scope);
  if (scope.error) {
    scope.error = null;
    notifyRemoteWatchlistScope(scope);
  }
  scheduleRemoteWatchlistSave(scope);
};

export function useRemoteWatchlistSync(watchlistId?: string) {
  const symbols = useWatchlistStore((state) => {
    const active = state.watchlists.find((watchlist) => watchlist.id === (watchlistId || state.activeWatchlistId));
    return active?.symbols ?? [];
  });
  const activeWatchlistId = useWatchlistStore((state) => watchlistId || state.activeWatchlistId);
  const isAuthenticated = useAppStore((state) => state.isAuthenticated);
  const accountId = useAppStore((state) => state.accountId);
  const storeAuthToken = useAppStore((state) => state.authToken);
  const storeRefreshToken = useAppStore((state) => state.refreshToken);
  const sessionRevision = useBrokerSessionRevision();
  const sessionDescriptor = useMemo(
    () => isAuthenticated && accountId
      ? getApiSessionDescriptor(accountId)
      : null,
    [accountId, isAuthenticated, sessionRevision],
  );
  const [scope, setScope] = useState<RemoteWatchlistScope | null>(null);
  const [, setRevision] = useState(0);
  const applyingSnapshotRef = useRef<string | null>(null);
  const localSnapshotScopeRef = useRef<string | null>(null);
  const skipInitialLocalSnapshotRef = useRef(false);
  if (localSnapshotScopeRef.current !== (scope?.key ?? null)) {
    localSnapshotScopeRef.current = scope?.key ?? null;
    skipInitialLocalSnapshotRef.current = Boolean(scope);
  }

  const reload = useCallback(async () => {
    if (!scope || !activeWatchlistId) return;
    const localSymbols = normalizeWatchlistSymbols(
      useWatchlistStore.getState().getWatchlistById(activeWatchlistId)?.symbols ?? [],
      scope.catalogSymbols,
    );
    await hydrateRemoteWatchlist(scope, localSymbols, true);
  }, [activeWatchlistId, scope]);

  useEffect(() => {
    if (!sessionDescriptor || !activeWatchlistId) {
      setScope(null);
      return;
    }
    const requestSession = captureApiSession(
      sessionDescriptor,
      storeAuthToken,
      storeRefreshToken,
    );
    if (!requestSession) {
      setScope(null);
      return;
    }
    const committedScope = getRemoteWatchlistScope(requestSession);
    if (committedScope.activeBindings === 0) committedScope.lifecycleGeneration += 1;
    committedScope.activeBindings += 1;
    const onChange = () => setRevision((revision) => revision + 1);
    committedScope.listeners.add(onChange);
    const localSymbols = normalizeWatchlistSymbols(
      useWatchlistStore.getState().getWatchlistById(activeWatchlistId)?.symbols ?? [],
      committedScope.catalogSymbols,
    );
    setScope(committedScope);
    void hydrateRemoteWatchlist(committedScope, localSymbols, false);
    onChange();

    return () => {
      committedScope.listeners.delete(onChange);
      committedScope.activeBindings = Math.max(0, committedScope.activeBindings - 1);
      if (committedScope.activeBindings === 0) {
        committedScope.lifecycleGeneration += 1;
        committedScope.abortController.abort();
        if (committedScope.saveTimer !== null) {
          window.clearTimeout(committedScope.saveTimer);
          committedScope.saveTimer = null;
        }
        if (committedScope.phase === 'loading') {
          committedScope.hydrationGeneration += 1;
          committedScope.hydrationPromise = null;
          committedScope.phase = 'idle';
        }
        persistPendingWatchlist(committedScope);
        remoteWatchlistScopes.delete(committedScope.key);
        committedScope.session.authToken = null;
        committedScope.session.requestContext = null;
      }
      applyingSnapshotRef.current = null;
      setScope((current) => current === committedScope ? null : current);
    };
  }, [
    activeWatchlistId,
    sessionDescriptor,
    storeAuthToken,
    storeRefreshToken,
  ]);

  useEffect(() => {
    if (!scope || scope.phase !== 'hydrated' || !activeWatchlistId) return;
    const snapshot = scope.desiredSymbols ?? scope.confirmedSymbols;
    if (!snapshot) return;

    const current = normalizeWatchlistSymbols(
      useWatchlistStore.getState().getWatchlistById(activeWatchlistId)?.symbols ?? [],
      scope.catalogSymbols,
    );
    if (sameSymbols(current, snapshot)) return;

    applyingSnapshotRef.current = snapshot.join('|');
    useWatchlistStore.getState().reorderSymbols(activeWatchlistId, snapshot);
  }, [activeWatchlistId, scope, scope?.revision]);

  useEffect(() => {
    if (!scope || !activeWatchlistId) return;
    const cleanSymbols = normalizeWatchlistSymbols(symbols, scope.catalogSymbols);
    if (skipInitialLocalSnapshotRef.current) {
      skipInitialLocalSnapshotRef.current = false;
      return;
    }
    if (applyingSnapshotRef.current !== null) {
      if (applyingSnapshotRef.current === cleanSymbols.join('|')) {
        applyingSnapshotRef.current = null;
      }
      return;
    }
    recordLocalWatchlistSnapshot(scope, cleanSymbols);
  }, [activeWatchlistId, scope, symbols]);

  return {
    loading: scope?.phase === 'loading',
    error: scope?.error ?? null,
    reload,
  };
}
