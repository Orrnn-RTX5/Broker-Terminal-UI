import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  apiClient,
  ApiError,
  type ApiRequestContext,
  type ApiRequestOptions,
} from '../api/client';
import { watchlistV2Api } from '../api/trade';
import { API_V2_BASE_URL, MARKET_WS_URL, toLocalDevProxyUrl } from '../config/api';
import { isDesktopBackendTarget } from '../config/backendTarget.js';
import { getEnhancedWebSocketService } from '../services/websocket-enhanced';
import { enqueueLiveTick } from '../services/liveTickDispatcher';
import { loadPublicMarketCatalog } from '../services/publicMarketCatalog';
import { loadSharedAuthenticatedInstruments } from '../services/authenticatedInstruments';
import { getAccessToken, getServerUrl, onSessionChange } from '../services/brokerSession';
import { resolveTickFromLookup, useAppStore, type Tick as AppTick } from '../store/useAppStore';
import { type Tick, useMarketDataStore } from '../store/useMarketDataStore';
import { useWatchlistStore } from '../store/useWatchlistStore';
import { readDailyChangePercent, resolveDailyChangePercent } from '../utils/dailyChange';
import { isStaleQuoteErrorMessage, resolveMarketWatchSymbolInput } from '../utils/marketWatchSource';
import { mergeAccountCatalogWithPublic, type AccountCatalogStatus } from '../utils/accountSymbolUniverse';
import {
  applySpreadMarkupToBookLevels,
  buildSpreadMarkupMap,
  normalizeSpreadMarkupSymbol,
  readSpreadMarkupPoints,
  roundPriceToDigits,
  type SpreadMarkupMap,
} from '../utils/spreadMarkup';
import {
  clearAccountSpreadMarkups,
  getAccountSpreadMarkupMap,
  onAccountSpreadMarkupChange,
  setAccountSpreadMarkups,
} from '../services/accountSpreadMarkup';
import { useQuoteSubscription } from './useQuoteSubscription';
import type { WatchlistItem } from '../types/api';

export interface MarketInstrument {
  symbol: string;
  description?: string;
  category?: string;
  digits?: number;
  bid?: number;
  ask?: number;
  spread?: number;
  contractSize?: number;
  tickSize?: number;
  minVolume?: number;
  maxVolume?: number;
  volumeStep?: number;
  marginRate?: number;
  swapLong?: number;
  swapShort?: number;
  commission?: number;
  tradingEnabled?: boolean;
  timestamp?: number;
  /** Authenticated catalogue only: account group spread markup in points. */
  spreadMarkup?: number;
}

export interface MarketInstrumentsSnapshot {
  symbols: MarketInstrument[];
  authorizedInstruments: MarketInstrument[];
  authorizedSymbols: string[];
  disabledSymbols: string[];
  authorizationSettled: boolean;
  /** Complete successful catalog for this broker/account, suitable for replacing saved selections. */
  chartCatalogCurrent?: boolean;
  /**
   * Authenticated account catalogue lifecycle. While `loading`/`loaded` the
   * `symbols` list is the account's own catalogue (empty until known), never
   * the public broker list. `none` for guests; `failed` = public fallback.
   */
  accountCatalogStatus?: AccountCatalogStatus;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

interface ScopedValue<T> {
  scope: string | null;
  value: T;
}

const EMPTY_MARKET_INSTRUMENTS: MarketInstrument[] = [];

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
  if (Number.isFinite(raw) && raw > 0) {
    // FIX: Normalize broker epoch units while keeping receipt-time fallback
    // separate from authoritative event time.
    if (raw >= 100_000_000_000_000_000) return raw / 1_000_000;
    if (raw >= 100_000_000_000_000) return raw / 1_000;
    return raw >= 100_000_000_000 ? raw : raw * 1_000;
  }
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const SOURCE_TIMESTAMP_KEYS = [
  'sourceTimestamp', 'source_timestamp', 'timestamp', 'timestamp_ms', 'timestampMs',
  'time', 'time_ms', 'timeMs', 'time_msc', 'timeMsc', 'tick_timestamp',
  'tickTimestamp', 'event_time', 'eventTime', 'server_time', 'serverTime',
] as const;

const readSourceTimestamp = (...records: Array<Record<string, unknown> | undefined>): number | undefined => {
  for (const record of records) {
    if (!record) continue;
    for (const key of SOURCE_TIMESTAMP_KEYS) {
      const normalized = sourceTimestampToMs(record[key]);
      if (normalized !== undefined) return normalized;
    }
  }
  return undefined;
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

  // FIX: Accept the timestamp aliases emitted by MT gateways and retain the
  // distinction between server event time and local receipt time.
  return readSourceTimestamp(payload, dataRecord, rawRecord);
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

const readOptionalInstrumentNumber = (raw: any, keys: readonly string[]): number | undefined => {
  for (const key of keys) {
    if (!hasOwn(raw, key)) continue;
    const value = raw?.[key];
    if (value === null || value === undefined || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const readOptionalInstrumentString = (raw: any, keys: readonly string[]): string | undefined => {
  for (const key of keys) {
    if (!hasOwn(raw, key)) continue;
    const value = raw?.[key];
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (normalized) return normalized;
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
    digits: readOptionalInstrumentNumber(raw, ['digits']),
    bid: readOptionalInstrumentNumber(raw, ['bid']),
    ask: readOptionalInstrumentNumber(raw, ['ask']),
    spread: readOptionalInstrumentNumber(raw, ['spread']),
    contractSize: readOptionalInstrumentNumber(raw, ['contract_size', 'contractSize']),
    tickSize: readOptionalInstrumentNumber(raw, ['tick_size', 'tickSize', 'point_size', 'pointSize', 'point']),
    minVolume: readOptionalInstrumentNumber(raw, ['min_volume', 'volume_min', 'minVolume', 'min_lot', 'minLot']),
    maxVolume: readOptionalInstrumentNumber(raw, ['max_volume', 'volume_max', 'maxVolume', 'max_lot', 'maxLot']),
    volumeStep: readOptionalInstrumentNumber(raw, ['volume_step', 'volumeStep', 'lot_step', 'lotStep']),
    marginRate: readOptionalInstrumentNumber(raw, ['margin_rate', 'marginRate', 'initial_margin', 'initialMargin']),
    swapLong: readOptionalInstrumentNumber(raw, ['swap_long', 'swapLong']),
    swapShort: readOptionalInstrumentNumber(raw, ['swap_short', 'swapShort']),
    commission: readOptionalInstrumentNumber(raw, ['commission', 'commission_per_lot', 'commissionPerLot']),
    tradingEnabled: normalizeInstrumentEnabled(raw),
    // FIX: Catalog quote seeds retain source time only when the backend sends it.
    timestamp: readSourceTimestamp(raw),
    spreadMarkup: readSpreadMarkupPoints(raw),
  };
};

/**
 * Markup of the account's own catalogue rows. Tick size/digits fall back to
 * the merged (public-enriched) row, but the markup itself never comes from
 * the public catalogue.
 */
export const buildAccountSpreadMarkupMap = (
  authorizedCatalog: readonly MarketInstrument[],
  accountUniverse: readonly MarketInstrument[],
): SpreadMarkupMap => {
  const universeBySymbol = new Map(
    accountUniverse.map((instrument) => [normalizeSpreadMarkupSymbol(instrument.symbol), instrument]),
  );
  return buildSpreadMarkupMap(authorizedCatalog.map((instrument) => {
    const merged = universeBySymbol.get(normalizeSpreadMarkupSymbol(instrument.symbol));
    return {
      symbol: instrument.symbol,
      spreadMarkup: instrument.spreadMarkup,
      tickSize: instrument.tickSize ?? merged?.tickSize,
      digits: instrument.digits ?? merged?.digits,
    };
  }));
};

const normalizeTick = (raw: any, fallbackSymbol?: string): (Tick & Partial<AppTick>) | null => {
  const payload = raw?.data?.quote ?? raw?.data?.tick ?? raw?.data ?? raw?.quote ?? raw?.tick ?? raw;
  const symbol = normalizeSymbol(payload?.symbol ?? raw?.symbol ?? fallbackSymbol);
  if (!symbol) return null;

  const bid = toNumber(payload?.bid);
  const ask = toNumber(payload?.ask, bid);
  if (bid <= 0 && ask <= 0) return null;

  const spread = toNumber(payload?.spread, ask - bid);
  const previousClose = readOptionalInstrumentNumber(payload, ['previous_close', 'previousClose']);
  const dailyOpen = readOptionalInstrumentNumber(payload, ['daily_open', 'dailyOpen', 'open', 'open_price', 'openPrice']);
  const close = readOptionalInstrumentNumber(payload, ['close', 'previous_close', 'previousClose', 'close_price', 'closePrice']);
  const last = readOptionalInstrumentNumber(payload, ['last', 'last_price', 'lastPrice']);
  const volume = readOptionalInstrumentNumber(payload, [
    'volume',
    'volume_24h',
    'volume24h',
    'tick_volume',
    'tickVolume',
    'real_volume',
    'realVolume',
  ]);
  const lp = readOptionalInstrumentString(payload, [
    'lp',
    'provider',
    'liquidity_provider',
    'liquidityProvider',
    'lp_name',
    'lpName',
  ]);
  const session = payload?.session ?? {};
  const high = readOptionalInstrumentNumber(payload, ['high']);
  const low = readOptionalInstrumentNumber(payload, ['low']);
  const sessionHigh = Math.max(
    toNumber(session?.high_bid),
    toNumber(session?.high_ask),
    high ?? 0
  );
  const sessionLowValues = [
    toNumber(session?.low_bid),
    toNumber(session?.low_ask),
    low ?? 0,
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
    lp,
    volume,
    last,
    dailyChange: resolveDailyChangePercent(
      readDailyChangePercent(payload),
      bid,
      previousClose,
    ),
    high24h: readOptionalInstrumentNumber(payload, ['high24h', 'high_24h']) ?? (sessionHigh || undefined),
    low24h: readOptionalInstrumentNumber(payload, ['low24h', 'low_24h']) ?? sessionLow,
    high,
    low,
    open: dailyOpen,
    close,
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
    spread: instrument.spread ?? Math.max(0, ask - bid),
    timestamp: instrument.timestamp ?? Date.now(),
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
  brokerId: string;
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
  const brokerId = getStoredBrokerId();
  const storageScopeKey = [v2BaseUrl, brokerId, accountId]
    .map(normalizeWatchlistScopePart)
    .join('|');
  return { storageScopeKey, v2BaseUrl, apiRootBaseUrl, accountId, brokerId };
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
  // FIX: Feed-status freshness uses the same gateway timestamp vocabulary as
  // quote ingestion, including millisecond and server-time aliases.
  const tickTimestamp = readSourceTimestamp({
    ...row,
    timestamp: row?.timestamp ?? row?.last_tick_time ?? row?.lastTickTime,
  });
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
  const requestAbortRef = useRef<AbortController | null>(null);
  const sessionRevision = useBrokerSessionRevision();
  // FIX: Capture routing/cache ownership per broker session so an old request
  // cannot commit into a newly selected broker after dynamic URLs change.
  const apiRootBaseUrl = useMemo(() => getApiRootBaseUrl(), [sessionRevision]);
  const storageScope = useMemo(() => getActiveMarketSymbolsStorageScope(), [sessionRevision]);

  const reload = useCallback(async () => {
    const requestGeneration = ++requestGenerationRef.current;
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get<any>('/ws/feed/status', {
        baseUrl: apiRootBaseUrl,
        skipAuth: true,
        skipDynamicUrl: true,
        signal: controller.signal,
      });
      if (requestGeneration !== requestGenerationRef.current || controller.signal.aborted) return;
      const nextSymbols = extractActiveMarketSymbols(response);

      if (nextSymbols.length > 0 || hasAuthoritativeMarketSymbolStatus(response)) {
        writeCachedActiveMarketSymbols({
          symbols: nextSymbols,
          updatedAt: Date.now(),
          availableCount: toOptionalNumber(response?.available_symbols?.length),
          silentCount: toOptionalNumber(response?.silent_symbols?.length),
        }, storageScope);
        setSymbols(nextSymbols);
        setCurrent(true);
        return;
      }

      const cached = readCachedActiveMarketSymbols(storageScope);
      setSymbols(cached.symbols);
      setCurrent(false);
      setError('No active feed symbols returned');
    } catch (err) {
      if (requestGeneration !== requestGenerationRef.current || controller.signal.aborted) return;
      const cached = readCachedActiveMarketSymbols(storageScope);
      setSymbols(cached.symbols);
      setCurrent(false);
      setError(err instanceof ApiError ? err.message : 'Failed to load active feed symbols');
    } finally {
      if (requestGeneration === requestGenerationRef.current && !controller.signal.aborted) {
        requestAbortRef.current = null;
        setSettled(true);
        setLoading(false);
      }
    }
  }, [apiRootBaseUrl, storageScope]);

  useEffect(() => {
    let cancelled = false;
    const handleStaleSymbols = (event: Event) => {
      const detail = (event as CustomEvent<MarketSymbolsStaleEventDetail>).detail;
      const staleSymbols = uniqueSymbols(detail?.symbols ?? []);

      if (staleSymbols.length > 0) {
        const staleSet = new Set(staleSymbols);
        setSymbols((current) => current.filter((symbol) => !staleSet.has(symbol)));
        const cached = readCachedActiveMarketSymbols(storageScope);
        writeCachedActiveMarketSymbols({
          ...cached,
          symbols: cached.symbols.filter((symbol) => !staleSet.has(symbol)),
          updatedAt: Date.now(),
        }, storageScope);
      }

      void reload();
    };

    window.addEventListener(MARKET_SYMBOLS_STALE_EVENT, handleStaleSymbols);
    void reload();
    const interval = window.setInterval(() => {
      if (!cancelled && document.visibilityState !== 'hidden') void reload();
    }, ACTIVE_MARKET_SYMBOLS_REFRESH_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (!cancelled && document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      cancelled = true;
      requestGenerationRef.current += 1;
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
      window.clearInterval(interval);
      window.removeEventListener(MARKET_SYMBOLS_STALE_EVENT, handleStaleSymbols);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [reload, storageScope]);

  return { symbols, loading, settled, current, error, reload };
}

export function useMarketInstruments(enabled = true): MarketInstrumentsSnapshot {
  // Every published list/status is tagged with the catalog scope that produced
  // it, so a login, logout or account switch never renders the previous universe.
  const [symbolsState, setSymbolsState] = useState<ScopedValue<MarketInstrument[]>>(
    { scope: null, value: EMPTY_MARKET_INSTRUMENTS },
  );
  const [authorizedInstruments, setAuthorizedInstruments] = useState<MarketInstrument[]>([]);
  const [authorizedSymbols, setAuthorizedSymbols] = useState<string[]>([]);
  const [disabledSymbols, setDisabledSymbols] = useState<string[]>([]);
  const [authorizationSettled, setAuthorizationSettled] = useState(false);
  const [completedCatalogScope, setCompletedCatalogScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isAuthenticated = useAppStore((state) => state.isAuthenticated);
  const [accountCatalogState, setAccountCatalogState] = useState<ScopedValue<AccountCatalogStatus>>(
    { scope: null, value: 'none' },
  );
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
  const publicApiRootBaseUrl = useMemo(
    () => getApiSessionDescriptor(accountId || 'public').apiRootBaseUrl,
    [accountId, sessionRevision],
  );
  // Quote display survives a refresh of the same catalog. Never reuse another
  // broker/account's catalog, and keep trade authorization independently gated.
  const catalogScope = `${publicApiRootBaseUrl}|${getStoredBrokerId()}|${isAuthenticated ? accountId || 'authenticated' : 'public'}`;
  const retainedCatalogRef = useRef<{
    scope: string;
    symbols: MarketInstrument[];
    source: 'public' | 'account';
  } | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    const setSymbols = (value: MarketInstrument[]) => setSymbolsState({ scope: catalogScope, value });
    const setAccountCatalogStatus = (value: AccountCatalogStatus) => (
      setAccountCatalogState({ scope: catalogScope, value })
    );
    const requestGeneration = ++requestGenerationRef.current;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;

    const controller = new AbortController();
    requestAbortRef.current = controller;
    const retained = retainedCatalogRef.current?.scope === catalogScope
      ? retainedCatalogRef.current
      : null;
    const retainedCatalog = retained?.symbols ?? [];
    if (retainedCatalog.length === 0) {
      retainedCatalogRef.current = null;
      setSymbols([]);
    }
    const loadsAccountCatalog = isAuthenticated && Boolean(requestSession);
    setLoading(retainedCatalog.length === 0);
    setError(null);
    // A logged-in account's symbol universe is its own catalogue. Until it is
    // known the universe stays empty (or the same account's retained catalogue)
    // so the public broker list is never flashed to the account.
    setAccountCatalogStatus(
      !isAuthenticated
        ? 'none'
        : retained?.source === 'public' ? 'failed' : 'loading',
    );
    // Never retain trade authorization from the previous request/session while
    // the current authenticated catalog is still being verified.
    setAuthorizedSymbols([]);
    setDisabledSymbols([]);
    setAuthorizedInstruments([]);
    setAuthorizationSettled(false);
    setCompletedCatalogScope(null);

    const isCurrentRequest = () => requestGeneration === requestGenerationRef.current
      && !controller.signal.aborted;
    // The public catalogue carries prices/specifications. For a logged-in
    // account it only enriches the account rows; its failure must not block
    // the account catalogue.
    let publicCatalog: MarketInstrument[] = [];
    let publicCatalogError: unknown = null;
    // Assigned by the concurrent requests below (a plain `null` initializer
    // would make TypeScript narrow it to null after the await).
    let authenticatedCatalog = null as MarketInstrument[] | null;
    let accountCatalogError: unknown = null;

    const publishPublicCatalog = (catalog: MarketInstrument[]) => {
      retainedCatalogRef.current = { scope: catalogScope, symbols: catalog, source: 'public' };
      setSymbols(catalog);
      upsertInstrumentTickSnapshots(catalog);
      setLoading(false);
    };
    const publishAccountUniverse = (authorizedCatalog: MarketInstrument[], session: CapturedApiSession) => {
      // The backend already filters this list by the account's group and
      // returns it in the group's order: it is the account symbol universe.
      const accountUniverse = mergeAccountCatalogWithPublic(authorizedCatalog, publicCatalog);
      // Publish the group's spread markup before seeding quotes so the seed
      // and every later tick are widened; a changed markup (new catalogue
      // revision) re-widens the already cached quotes.
      setAccountSpreadMarkups(
        session.accountId,
        buildAccountSpreadMarkupMap(authorizedCatalog, accountUniverse),
      );
      retainedCatalogRef.current = { scope: catalogScope, symbols: accountUniverse, source: 'account' };
      setSymbols(accountUniverse);
      upsertInstrumentTickSnapshots(accountUniverse);
      setLoading(false);
    };

    // Neither catalog depends on the other. Start both together so a slow or
    // unavailable public endpoint cannot delay the broker's authorized list.
    const publicRequest = (async () => {
      try {
        const response = await loadPublicMarketCatalog(publicApiRootBaseUrl, controller.signal);
        if (!isCurrentRequest()) return;

        const catalog = extractInstrumentRows(response)
          .map(normalizeInstrument)
          .filter(Boolean) as MarketInstrument[];
        if (catalog.length === 0) {
          throw new ApiError(0, 'No symbols returned by /api/v1/market/symbols');
        }
        publicCatalog = catalog;

        if (!loadsAccountCatalog) {
          // Guests (and an authenticated state without a usable session) never
          // carry an account's spread markup.
          clearAccountSpreadMarkups();
          publishPublicCatalog(catalog);
          if (!isAuthenticated) {
            setCompletedCatalogScope(catalogScope);
          } else {
            // Authenticated without a usable session: read-only public fallback,
            // trading stays disabled (no authorized symbols).
            setAccountCatalogStatus('failed');
          }
        } else if (authenticatedCatalog && requestSession) {
          // The account universe arrived first: enrich it with the public
          // prices/specifications without widening it to the public list.
          publishAccountUniverse(authenticatedCatalog, requestSession);
        }
      } catch (err) {
        if (!isCurrentRequest()) return;
        publicCatalogError = err;
      } finally {
        if (isCurrentRequest() && !loadsAccountCatalog) {
          setAuthorizationSettled(true);
        }
      }
    })();

    const authorizationRequest = (async () => {
      if (!loadsAccountCatalog || !requestSession) return;
      const session = requestSession;
      try {
        const authorizedResponse = await loadSharedAuthenticatedInstruments(
          getCapturedRequestOptions(session, session.v2BaseUrl, controller.signal),
          session,
        );
        if (!isCurrentRequest()) return;
        const authorizedCatalog = extractInstrumentRows(authorizedResponse)
          .map(normalizeInstrument)
          .filter(Boolean) as MarketInstrument[];
        authenticatedCatalog = authorizedCatalog;
        publishAccountUniverse(authorizedCatalog, session);
        // FIX: Retain authenticated broker specifications, not only their names,
        // so order controls can enforce each exact symbol's volume grid.
        setAuthorizedInstruments(authorizedCatalog);
        const disabled = authorizedCatalog
          .filter((instrument) => instrument.tradingEnabled === false)
          .map((instrument) => instrument.symbol);
        const tradable = authorizedCatalog
          .filter((instrument) => instrument.tradingEnabled !== false)
          .map((instrument) => instrument.symbol);
        const watchlistScope = remoteWatchlistScopes.get(session.runtimeKey);
        if (watchlistScope) {
          watchlistScope.catalogSymbols = normalizeWatchlistSymbols(
            authorizedCatalog.map((instrument) => instrument.symbol),
          );
        }
        setAuthorizedSymbols(uniqueSymbols(tradable));
        setDisabledSymbols(uniqueSymbols(disabled));
        setAccountCatalogStatus('loaded');
      } catch (err) {
        if (!isCurrentRequest()) return;
        accountCatalogError = err;
        // Trading actions stay disabled until the authenticated catalog can
        // prove that a symbol is authorized.
        setAuthorizedSymbols([]);
        setDisabledSymbols([]);
        setAuthorizedInstruments([]);
      } finally {
        if (isCurrentRequest()) {
          setAuthorizationSettled(true);
        }
      }
    })();

    try {
      await Promise.all([publicRequest, authorizationRequest]);
      if (!isCurrentRequest()) return;
      if (loadsAccountCatalog) {
        if (authenticatedCatalog) {
          // Preserve saved pane selections until both sources settle before
          // allowing reconciliation against the account universe.
          setCompletedCatalogScope(catalogScope);
        } else if (retained?.source === 'account') {
          // Keep this account's last known universe; never widen it to the
          // public list. Trading stays disabled until authorization succeeds.
          setSymbols(retained.symbols);
          setAccountCatalogStatus('loaded');
        } else if (publicCatalog.length > 0) {
          // Fallback: read-only public catalogue. Trading actions stay disabled
          // until the authenticated catalog can prove that a symbol is authorized.
          publishPublicCatalog(publicCatalog);
          setAccountCatalogStatus('failed');
        } else {
          const err = publicCatalogError ?? accountCatalogError;
          setSymbols(retainedCatalog);
          setAccountCatalogStatus('failed');
          setError(err instanceof Error ? err.message : 'Failed to load symbols');
        }
      } else if (publicCatalogError) {
        setSymbols(retainedCatalog);
        if (isAuthenticated) {
          setAccountCatalogStatus(retained?.source === 'account' ? 'loaded' : 'failed');
        }
        setError(publicCatalogError instanceof Error ? publicCatalogError.message : 'Failed to load symbols');
      }
    } finally {
      if (isCurrentRequest()) {
        requestAbortRef.current = null;
        setLoading(false);
      }
    }
  }, [catalogScope, enabled, isAuthenticated, publicApiRootBaseUrl, requestSession]);

  useEffect(() => {
    if (!enabled) return;
    void reload();
    return () => {
      requestGenerationRef.current += 1;
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
    };
  }, [enabled, reload]);

  // Derive synchronously so a login/logout/account switch never renders one
  // frame with the previous session's symbols or universe classification.
  const effectiveAccountCatalogStatus: AccountCatalogStatus = !isAuthenticated
    ? 'none'
    : accountCatalogState.scope === catalogScope && accountCatalogState.value !== 'none'
      ? accountCatalogState.value
      : 'loading';
  const visibleSymbols = symbolsState.scope === catalogScope
    ? symbolsState.value
    : EMPTY_MARKET_INSTRUMENTS;

  return {
    symbols: visibleSymbols,
    authorizedInstruments: enabled ? authorizedInstruments : [],
    authorizedSymbols: enabled ? authorizedSymbols : [],
    disabledSymbols: enabled ? disabledSymbols : [],
    authorizationSettled: enabled && authorizationSettled,
    chartCatalogCurrent: enabled && completedCatalogScope === catalogScope && authorizationSettled,
    accountCatalogStatus: effectiveAccountCatalogStatus,
    loading: !enabled || loading || (effectiveAccountCatalogStatus === 'loading' && visibleSymbols.length === 0),
    error,
    reload,
  };
}

export function useLiveQuotes(symbols: string[]) {
  const quoteDemandId = useId();
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
  const marketDataEnabled = isAuthenticated || !isDesktopBackendTarget();
  const accountId = useAppStore((state) => state.accountId);
  const storeAuthToken = useAppStore((state) => state.authToken);
  const storeRefreshToken = useAppStore((state) => state.refreshToken);
  const sessionRevision = useBrokerSessionRevision();
  const quoteSessionDescriptor = useMemo(
    () => isAuthenticated ? getApiSessionDescriptor(accountId || 'authenticated') : null,
    [accountId, isAuthenticated, sessionRevision],
  );
  const quoteRequestSession = useMemo(
    () => quoteSessionDescriptor
      ? captureApiSession(quoteSessionDescriptor, storeAuthToken, storeRefreshToken)
      : null,
    [quoteSessionDescriptor, storeAuthToken, storeRefreshToken],
  );
  const quoteApiBaseUrl = quoteSessionDescriptor?.v2BaseUrl ?? API_V2_BASE_URL;

  // Section 2: Public /ws/v2 quote demand is owned by QuoteSocketManager.
  useQuoteSubscription(marketDataEnabled ? normalizedSymbols : [], `live-quotes:${quoteDemandId}`);

  // Authenticated REST supplies the initial account-scoped quote snapshot.
  // Guests are seeded by the public instrument catalog and updated by the feed;
  // some deployed brokers do not support anonymous v2 quote requests.
  useEffect(() => {
    if (!isAuthenticated) {
      failureRef.current = null;
      setError(null);
      setLoading(false);
      return;
    }

    if (normalizedSymbols.length === 0) {
      setLoading(false);
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
    const batches = getLiveQuoteRestBatches(normalizedSymbols);

    const loadInitialQuoteBatch = async () => {
      if (cancelled || batches.length === 0) return;
      setLoading(true);
      try {
        // FIX: Load every bounded batch under one captured session; previously
        // only the first 50 symbols received a deterministic REST seed.
        const responses = await Promise.all(batches.map((batch) => apiClient.get<any>('/quotes', {
          // FIX: Quotes can be public during the short login handoff. Pin the
          // URL either way; attach captured credentials only when available.
          ...(quoteRequestSession
            ? getCapturedRequestOptions(quoteRequestSession, quoteRequestSession.v2BaseUrl)
            : { baseUrl: quoteApiBaseUrl, skipDynamicUrl: true, skipAuth: true }),
          params: { symbols: batch.join(',') },
        })));
        if (cancelled) return;

        const quotes = responses.flatMap((response) => (
          Array.isArray(response) ? response : response?.quotes ?? []
        ));
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

            const marketTick = useMarketDataStore.getState().symbolData[tick.symbol]?.currentTick;
            const appState = useAppStore.getState();
            const existingTick = marketTick
              ?? resolveTickFromLookup(appState.ticks, appState.tickLookup, tick.symbol);
            // FIX: Timestamp-less REST/catalog data may seed an empty symbol,
            // but can never supersede an authoritative WebSocket observation.
            if (sourceTimestamp === undefined && existingTick?.sourceTimestamp !== undefined) return;

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
          const staleFailure = getStaleQuoteFailure(err, normalizedSymbols);
          const failedSymbols = staleFailure.symbols.length > 0
            ? staleFailure.symbols
            : normalizedSymbols;
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
        if (!cancelled) setLoading(false);
      }
    };

    void loadInitialQuoteBatch();
    return () => {
      cancelled = true;
    };
  }, [normalizedSymbols.join('|'), isAuthenticated, quoteRequestSession, quoteApiBaseUrl, sessionRevision]);

  // Subscribe in MarketDataStore for aggregation tracking
  useEffect(() => {
    if (normalizedSymbols.length === 0 || !marketDataEnabled) return;

    normalizedSymbols.forEach((symbol) => {
      useMarketDataStore.getState().subscribeSymbol(symbol);
    });

    return () => {
      normalizedSymbols.forEach((symbol) => {
        useMarketDataStore.getState().unsubscribeSymbol(symbol);
      });
    };
  }, [normalizedSymbols.join('|'), marketDataEnabled, sessionRevision]);

  // Clear a stale failure only after every failed symbol receives a fresh
  // websocket tick. Healthy ticks for other symbols must not hide the failure.
  useEffect(() => {
    if (normalizedSymbols.length === 0 || !marketDataEnabled) return;

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
  }, [normalizedSymbols.join('|'), marketDataEnabled]);

  return { loading, error };
}

/** Depth levels widened like the account's top-of-book quote. */
export const applySpreadMarkupToOrderBook = (
  orderBook: LiveOrderBook | null,
  markupMap: SpreadMarkupMap,
): LiveOrderBook | null => {
  if (!orderBook) return orderBook;
  const entry = markupMap.get(normalizeSpreadMarkupSymbol(orderBook.symbol));
  if (!entry) return orderBook;
  const bids = applySpreadMarkupToBookLevels(orderBook.bids, 'bid', entry);
  const asks = applySpreadMarkupToBookLevels(orderBook.asks, 'ask', entry);
  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  const spread = bestBid > 0 && bestAsk > 0
    ? roundPriceToDigits(bestAsk - bestBid, entry.digits)
    : 0;
  return {
    ...orderBook,
    bids,
    asks,
    spread,
    spreadPips: getSpreadPips(orderBook.symbol, spread),
  };
};

const useAccountSpreadMarkupMap = (): SpreadMarkupMap =>
  useSyncExternalStore(onAccountSpreadMarkupChange, getAccountSpreadMarkupMap, getAccountSpreadMarkupMap);

export function useLiveOrderBook(symbol: string, depth: number) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const [rawOrderBook, setOrderBook] = useState<LiveOrderBook | null>(null);
  const spreadMarkupMap = useAccountSpreadMarkupMap();
  const orderBook = useMemo(
    () => applySpreadMarkupToOrderBook(rawOrderBook, spreadMarkupMap),
    [rawOrderBook, spreadMarkupMap],
  );
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
    void reload();
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
