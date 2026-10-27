import { enqueueSnapshotTick } from '../../services/liveTickDispatcher';
import {
  composeDailyChangeQuoteContext,
  readDailyChangeLastPrice,
  readDailyChangePercent,
  readDailyChangeInput,
  readDailyChangePreviousClose,
  resolveDailyChangePercent,
} from '../../utils/dailyChange';
import {
  readRegisteredSymbolPriceSpec,
  resolveDailyChangePriceMode,
} from '../../services/dailyChangePriceModeRegistry';
import { isStaleQuoteErrorMessage } from '../../utils/marketWatchSource';
import { readQuoteSessionRange } from '../../utils/quoteSessionRange';
import { getPipSizeFromDigits, resolveSpecDigits } from '../../utils/symbolUtils';
import {
  buildSpreadMarkupMap,
  normalizeSpreadMarkupSymbol,
  readSpreadMarkupPoints,
  type SpreadMarkupMap,
} from '../../utils/spreadMarkup';
import { resolveTickFromLookup, useAppStore, type Tick as AppTick } from '../../store/useAppStore';
import { type Tick } from '../../store/useMarketDataStore';
import type {
  LiveOrderBook,
  MarketInstrument,
  OrderBookLevel,
  StaleQuoteFailure,
} from './marketDataTypes';

export const normalizeSymbol = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toUpperCase() : '';

export const uniqueSymbols = (symbols: unknown[]): string[] =>
  Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)));

export const toNumber = (value: unknown, fallback = 0): number => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

export const toOptionalNumber = (value: unknown): number | undefined => {
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

export const readSourceTimestamp = (...records: Array<Record<string, unknown> | undefined>): number | undefined => {
  for (const record of records) {
    if (!record) continue;
    for (const key of SOURCE_TIMESTAMP_KEYS) {
      const normalized = sourceTimestampToMs(record[key]);
      if (normalized !== undefined) return normalized;
    }
  }
  return undefined;
};

interface QuotePayloadContext {
  payload: Record<string, unknown>;
  /** Nearest wrapper first, followed by progressively outer wrappers. */
  envelopes: readonly Record<string, unknown>[];
}

const QUOTE_CONTAINER_KEYS = ['data', 'quote', 'tick', 'payload', 'message'] as const;

const asQuoteRecord = (value: unknown): Record<string, unknown> | undefined => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
);

const hasDirectBidAsk = (record: Record<string, unknown>): boolean => (
  record.bid !== undefined
  || record.ask !== undefined
);

const hasDirectLast = (record: Record<string, unknown>): boolean => (
  record.last !== undefined
  || record.last_price !== undefined
  || record.lastPrice !== undefined
);

const getQuotePayloadContext = (
  value: unknown,
  envelopes: readonly Record<string, unknown>[] = [],
): QuotePayloadContext | undefined => {
  const record = asQuoteRecord(value);
  if (!record) return undefined;

  for (const key of QUOTE_CONTAINER_KEYS) {
    const nested = asQuoteRecord(record[key]);
    if (!nested) continue;
    const nestedContext = getQuotePayloadContext(nested, [record, ...envelopes]);
    if (
      nestedContext
      && (hasDirectBidAsk(nestedContext.payload) || hasDirectLast(nestedContext.payload))
    ) {
      return nestedContext;
    }
  }

  if (hasDirectBidAsk(record)) return { payload: record, envelopes };
  if (hasDirectLast(record)) return { payload: record, envelopes };
  return { payload: record, envelopes };
};

export const getSourceTickTimestamp = (raw: unknown): number | undefined => {
  const context = getQuotePayloadContext(raw);
  if (!context) return undefined;

  // FIX: Accept the timestamp aliases emitted by MT gateways and retain the
  // distinction between server event time and local receipt time.
  return readSourceTimestamp(context.payload, ...context.envelopes);
};

/**
 * Spread in pips from broker precision only. Digits come from the registered
 * broker catalog first, then the caller's instrument sources (e.g. the spread
 * markup entry's digits). Returns null when no broker digits are known; the
 * pip factor is never guessed from the symbol name (TERM-DIGITS-WL).
 */
export const getSpreadPips = (
  symbol: string,
  spread: number,
  ...digitsSources: unknown[]
): number | null => {
  const digits = resolveSpecDigits(readRegisteredSymbolPriceSpec(symbol).digits, ...digitsSources);
  const pipSize = getPipSizeFromDigits(digits);
  if (pipSize === null || !Number.isFinite(spread)) return null;
  // The terminal's single pip rule (shared with spread display and chart).
  return spread / pipSize;
};

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'on', 'enabled', 'enable', 'active', 'available', 'tradable', 'trading']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'n', 'off', 'disabled', 'disable', 'inactive', 'suspended', 'halted', 'blocked', 'readonly', 'read_only', 'deleted', 'delisted', 'expired', 'close_only']);

const hasOwn = (value: unknown, key: string): boolean =>
  Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key));

export const parseBooleanish = (value: unknown): boolean | undefined => {
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

export const normalizeInstrumentEnabled = (raw: unknown): boolean | undefined => {
  const record = asQuoteRecord(raw) ?? {};
  const enabledKeys = ['trading_enabled', 'tradingEnabled', 'enabled', 'is_enabled', 'isEnabled'];

  for (const key of enabledKeys) {
    if (!hasOwn(record, key)) continue;
    const parsed = parseBooleanish(record[key]);
    if (parsed !== undefined) return parsed;
  }

  if (hasOwn(record, 'status')) {
    return parseBooleanish(record.status);
  }

  return undefined;
};

const readOptionalInstrumentNumber = (raw: unknown, keys: readonly string[]): number | undefined => {
  const record = asQuoteRecord(raw) ?? {};
  for (const key of keys) {
    if (!hasOwn(record, key)) continue;
    const value = record[key];
    if (value === null || value === undefined || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const readOptionalInstrumentString = (raw: unknown, keys: readonly string[]): string | undefined => {
  const record = asQuoteRecord(raw) ?? {};
  for (const key of keys) {
    if (!hasOwn(record, key)) continue;
    const value = record[key];
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return undefined;
};

export const snapshotBrokerSpecification = (raw: unknown): Readonly<Record<string, unknown>> | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;

  // API responses are JSON records. Copy and freeze the top-level row so later
  // adapter work cannot mutate the catalog object retained for Specification.
  // Nested broker sections remain intact for alias-aware readers.
  return Object.freeze({ ...(raw as Record<string, unknown>) });
};

export const normalizeInstrument = (raw: unknown): MarketInstrument | null => {
  const record = asQuoteRecord(raw) ?? {};
  const symbol = normalizeSymbol(record.symbol ?? record.name ?? record.id ?? raw);
  if (!symbol) return null;

  return {
    symbol,
    brokerSpecification: snapshotBrokerSpecification(raw),
    description: (record.description ?? record.display_name ?? record.name) as string | undefined,
    category: (record.category ?? record.asset_class ?? record.type) as string | undefined,
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
    timestamp: readSourceTimestamp(record),
    spreadMarkup: readSpreadMarkupPoints(record),
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

export const normalizeTick = (raw: unknown, fallbackSymbol?: string): (Tick & Partial<AppTick>) | null => {
  const payloadContext = getQuotePayloadContext(raw);
  if (!payloadContext) return null;
  const { payload, envelopes } = payloadContext;
  const envelopeSymbol = envelopes.find((candidate) => normalizeSymbol(candidate.symbol))?.symbol;
  const symbol = normalizeSymbol(payload.symbol)
    || normalizeSymbol(envelopeSymbol)
    || normalizeSymbol(fallbackSymbol);
  if (!symbol) return null;

  const dailyChangeContext = composeDailyChangeQuoteContext(
    payload,
    envelopes[0],
    envelopes.slice(1),
  );
  const last = readDailyChangeLastPrice(dailyChangeContext);
  const priceMode = resolveDailyChangePriceMode(
    payload,
    symbol,
    envelopes[0],
    envelopes.slice(1),
  );
  const bid = toNumber(payload?.bid);
  const ask = toNumber(payload?.ask, bid);
  const dailyInput = readDailyChangeInput({ ...dailyChangeContext, bid: payload?.bid }, priceMode);
  // Preserve Last-only data as metadata. Zero sides keep it non-executable and
  // let the dispatcher exclude it from market/OHLC paths.
  if (bid <= 0 && ask <= 0 && dailyInput.last === undefined
    && dailyInput.previousClose === undefined && dailyInput.settlement === undefined
    && dailyInput.upstreamPercent === undefined && dailyInput.upstreamChange === undefined
    && dailyInput.status === undefined && dailyInput.sessionId === undefined) return null;

  const spread = toNumber(payload?.spread, ask - bid);
  const previousClose = readDailyChangePreviousClose(dailyChangeContext);
  const dailyOpen = readOptionalInstrumentNumber(payload, ['daily_open', 'dailyOpen', 'open', 'open_price', 'openPrice']);
  const close = readOptionalInstrumentNumber(payload, ['close', 'close_price', 'closePrice']) ?? previousClose;
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
  const session = asQuoteRecord(payload.session) ?? {};
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
    dailyChangeInput: dailyInput,
    dailyChange: resolveDailyChangePercent(
      readDailyChangePercent(dailyChangeContext),
      bid,
      previousClose,
      dailyChangeContext,
      priceMode,
    ),
    high24h: readOptionalInstrumentNumber(payload, ['high24h', 'high_24h']) ?? (sessionHigh || undefined),
    low24h: readOptionalInstrumentNumber(payload, ['low24h', 'low_24h']) ?? sessionLow,
    high,
    low,
    ...readQuoteSessionRange(payload),
    open: dailyOpen,
    close,
  };
};

const withTotals = (levels: unknown[]): OrderBookLevel[] => {
  let runningTotal = 0;
  return levels
    .map((level) => {
      const record = asQuoteRecord(level);
      const price = toNumber(Array.isArray(level) ? level[0] : (record?.price ?? record?.rate));
      const volume = toNumber(
        Array.isArray(level)
          ? level[1]
          : (record?.volume ?? record?.size ?? record?.qty ?? record?.quantity ?? record?.amount ?? record?.lots),
      );
      runningTotal += volume;
      return { price, volume, total: toNumber(record?.total, runningTotal) };
    })
    .filter((level) => level.price > 0 && level.volume >= 0);
};

export const normalizeOrderBook = (raw: unknown, fallbackSymbol?: string): LiveOrderBook | null => {
  const record = asQuoteRecord(raw) ?? {};
  const data = asQuoteRecord(record.data);
  const payload = asQuoteRecord(data?.orderBook)
    ?? asQuoteRecord(data?.depth)
    ?? data
    ?? asQuoteRecord(record.orderBook)
    ?? asQuoteRecord(record.depth)
    ?? record;
  const symbol = normalizeSymbol(payload.symbol ?? record.symbol ?? fallbackSymbol);
  const bids = withTotals(Array.isArray(payload.bids) ? payload.bids : []);
  const asks = withTotals(Array.isArray(payload.asks) ? payload.asks : []);
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
    timestamp: timestampToMs(payload.timestamp ?? payload.time ?? record.timestamp),
  };
};

export const upsertTick = (tick: Tick & Partial<AppTick>): void => {
  // REST and catalogue snapshots: their quote may be old, so they never stamp feed activity.
  enqueueSnapshotTick(tick.symbol, tick);
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

export const upsertInstrumentTickSnapshots = (instruments: MarketInstrument[]): void => {
  instruments.forEach(upsertInstrumentTickSnapshot);
};

export const MARKET_SYMBOLS_STALE_EVENT = 'rtx:market-symbols-stale';

interface MarketSymbolsStaleEventDetail {
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

export const dispatchStaleMarketSymbols = (symbols: readonly string[]): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<MarketSymbolsStaleEventDetail>(MARKET_SYMBOLS_STALE_EVENT, {
    detail: { symbols: uniqueSymbols([...symbols]) },
  }));
};

export const extractInstrumentRows = (response: unknown): unknown[] => {
  const record = asQuoteRecord(response) ?? {};
  if (Array.isArray(response)) return response;
  if (Array.isArray(record.symbols)) return record.symbols;
  if (Array.isArray(record.instruments)) return record.instruments;
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.result)) return record.result;
  return [];
};
