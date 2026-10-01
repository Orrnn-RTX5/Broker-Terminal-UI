const DAILY_CHANGE_PERCENT_KEYS = [
  'dailyChangePct',
  'daily_change_pct',
  'dailyChange',
  'daily_change',
] as const;

const LAST_PRICE_KEYS = ['last', 'last_price', 'lastPrice'] as const;

const PREVIOUS_CLOSE_PRICE_KEYS = ['previous_close', 'previousClose'] as const;
const DAILY_CHANGE_PRICE_KEYS = ['daily_change_price', 'dailyChangePrice', 'daily_change_amount'] as const;

const CHART_PRICE_MODE_KEYS = ['chart_mode', 'chartMode'] as const;

const SETTLEMENT_PRICE_KEYS = [
  'settlement_price',
  'settlementPrice',
  'session_price_settlement',
  'sessionPriceSettlement',
  'price_settlement',
  'priceSettlement',
  'settlement',
  'clearing_price',
  'clearingPrice',
  'session_price_clearing',
  'sessionPriceClearing',
  'price_clearing',
  'priceClearing',
  'clearing',
] as const;

const DAILY_CHANGE_CONTEXT_ALIAS_GROUPS = [
  DAILY_CHANGE_PERCENT_KEYS,
  DAILY_CHANGE_PRICE_KEYS,
  LAST_PRICE_KEYS,
  SETTLEMENT_PRICE_KEYS,
  PREVIOUS_CLOSE_PRICE_KEYS,
  CHART_PRICE_MODE_KEYS,
  ['provider', 'quote_provider'],
  ['reference_provider'],
  ['session_id', 'trading_day'],
  ['session_start'], ['session_end'], ['reference_session_id'], ['reference_price_mode'], ['reference_as_of'],
  ['market_status', 'quote_status'], ['negative_reference_convention'], ['reference_price_adjustment'], ['price_adjustment'],
] as const;

const asRecord = (value: unknown): Record<string, unknown> | undefined => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
);

const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};

const readFirstFiniteAlias = (
  quote: Record<string, unknown>,
  keys: readonly string[],
  accept: (value: number) => boolean = () => true,
): number | undefined => {
  for (const key of keys) {
    const numeric = toFiniteNumber(quote[key]);
    if (numeric !== undefined && accept(numeric)) return numeric;
  }
  return undefined;
};

const hasOwnAlias = (
  record: Record<string, unknown> | undefined,
  keys: readonly string[],
): record is Record<string, unknown> => Boolean(
  record && keys.some((key) => Object.prototype.hasOwnProperty.call(record, key)),
);

/**
 * Compose the Daily Change metadata carried by a normalized quote payload and
 * its transport envelope. Precedence is decided independently for each
 * semantic alias group: if the child owns any alias in a group, that complete
 * child group wins even when its value is null, unknown, or otherwise invalid.
 * This prevents an outer wrapper from silently overriding explicit child data.
 */
export const composeDailyChangeQuoteContext = (
  payload: unknown,
  envelope?: unknown,
  ancestorEnvelopes: readonly unknown[] = [],
): Record<string, unknown> => {
  const child = asRecord(payload);
  const envelopes = [envelope, ...ancestorEnvelopes]
    .map(asRecord)
    .filter((record): record is Record<string, unknown> => record !== undefined);
  const context: Record<string, unknown> = {};

  DAILY_CHANGE_CONTEXT_ALIAS_GROUPS.forEach((keys) => {
    const source = hasOwnAlias(child, keys)
      ? child
      : envelopes.find((candidate) => hasOwnAlias(candidate, keys));
    if (!source) return;

    keys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        context[key] = source[key];
      }
    });
  });

  return context;
};

export type DailyChangePriceMode = 'bid' | 'last';

const normalizeChartPriceMode = (value: unknown): DailyChangePriceMode | undefined => {
  const numeric = toFiniteNumber(value);
  if (numeric === 0) return 'bid';
  if (numeric === 1) return 'last';
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if ([
    'bid',
    'bidprice',
    'bybid',
    'bybidprice',
    'chartmodebid',
    'symbolchartmodebid',
  ].includes(normalized)) return 'bid';
  if ([
    'last',
    'lastprice',
    'bylast',
    'bylastprice',
    'chartmodelast',
    'symbolchartmodelast',
  ].includes(normalized)) return 'last';
  return undefined;
};

/**
 * Read only an explicit broker chart-price mode. Missing/unknown metadata is
 * intentionally not inferred from the presence of a Last field: a sparse Bid
 * tick may carry Last as supplemental metadata.
 */
export const readDailyChangePriceMode = (payload: unknown): DailyChangePriceMode | undefined => {
  const quote = asRecord(payload);
  if (!quote) return undefined;
  for (const key of CHART_PRICE_MODE_KEYS) {
    const mode = normalizeChartPriceMode(quote[key]);
    if (mode) return mode;
  }
  return undefined;
};

/** Read a positive exchange Last price without treating a generic price as Last. */
export const readDailyChangeLastPrice = (payload: unknown): number | undefined => {
  const quote = asRecord(payload);
  return quote
    ? readFirstFiniteAlias(quote, LAST_PRICE_KEYS, value => value > 0)
    : undefined;
};

/** Read the first usable broker percentage alias in documented priority order. */
export const readDailyChangePercent = (payload: unknown): number | undefined => {
  const quote = asRecord(payload);
  return quote ? readFirstFiniteAlias(quote, DAILY_CHANGE_PERCENT_KEYS) : undefined;
};

/** Read a finite previous-session close from a composed Daily Change context. */
export const readDailyChangePreviousClose = (payload: unknown): number | undefined => {
  const quote = asRecord(payload);
  return quote ? readFirstFiniteAlias(quote, PREVIOUS_CLOSE_PRICE_KEYS) : undefined;
};

/**
 * Resolve broker Daily Change without substituting a different market measure.
 * A finite broker percentage wins. Otherwise the symbol's Bid/Last chart mode
 * selects the current price and a positive settlement/clearing price takes
 * precedence over the previous session close.
 */
export const resolveDailyChangePercent = (
  upstreamDailyChange: unknown,
  bid: number,
  previousClose: unknown,
  quoteContext?: unknown,
  registeredPriceMode?: DailyChangePriceMode,
): number | undefined => {
  const normalizedUpstreamValue = toFiniteNumber(upstreamDailyChange);
  if (normalizedUpstreamValue !== undefined) return normalizedUpstreamValue;

  const quote = asRecord(quoteContext);
  const currentPrice = (readDailyChangePriceMode(quote) ?? registeredPriceMode) === 'last'
    ? readDailyChangeLastPrice(quote)
    : (Number.isFinite(bid) && bid > 0 ? bid : undefined);
  if (currentPrice === undefined) return undefined;

  const settlementPrice = quote
    ? readFirstFiniteAlias(quote, SETTLEMENT_PRICE_KEYS, value => value > 0)
    : undefined;
  const normalizedPreviousClose = toFiniteNumber(previousClose);
  const baseline = settlementPrice
    ?? (normalizedPreviousClose !== undefined && normalizedPreviousClose > 0
      ? normalizedPreviousClose
      : undefined);
  if (baseline === undefined) {
    return undefined;
  }

  return calculateDailyChange(currentPrice, baseline).percent;
};

export interface DailyChangeValues { change?: number; percent?: number }

/** Full precision arithmetic. Zero and negative references are explicit cases. */
export const calculateDailyChange = (
  price: unknown,
  reference: unknown,
  negativeConvention?: 'signed' | 'absolute',
): DailyChangeValues => {
  const p = toFiniteNumber(price);
  const r = toFiniteNumber(reference);
  if (p === undefined || r === undefined) return {};
  const change = p - r;
  const denominator = r < 0 && negativeConvention === 'absolute' ? Math.abs(r) : r;
  const percent = r === 0 || (r < 0 && !negativeConvention)
    ? undefined : change / denominator * 100;
  return {
    change: Number.isFinite(change) ? change : undefined,
    percent: percent !== undefined && Number.isFinite(percent) ? percent : undefined,
  };
};

/** Round only at the presentation boundary; a rounded zero has no sign. */
export const formatDailyChange = (value: unknown, digits = 2, percent = false): string => {
  const numeric = toFiniteNumber(value);
  if (numeric === undefined) return '—';
  const precision = Number.isInteger(digits) ? Math.max(0, Math.min(12, digits)) : 2;
  const rounded = Number(numeric.toFixed(precision));
  return `${rounded > 0 ? '+' : ''}${(rounded === 0 ? 0 : rounded).toFixed(precision)}${percent ? '%' : ''}`;
};

export interface DailyChangeInput {
  bid?: number;
  last?: number;
  mode?: DailyChangePriceMode | null;
  previousClose?: number | null;
  settlement?: number | null;
  upstreamPercent?: number | null;
  upstreamChange?: number | null;
  provider?: string;
  referenceProvider?: string;
  sessionId?: string;
  referenceSessionId?: string;
  sessionStart?: number;
  sessionEnd?: number;
  referenceMode?: DailyChangePriceMode;
  referenceAsOf?: number;
  adjustment?: string;
  referenceAdjustment?: string;
  negativeConvention?: 'signed' | 'absolute';
  status?: 'live' | 'delayed' | 'stale' | 'disconnected' | 'closed';
}

const readText = (record: Record<string, unknown>, keys: readonly string[]): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
};
const readTime = (value: unknown): number | undefined => {
  const numeric = toFiniteNumber(value);
  if (numeric !== undefined) return numeric > 0 ? (numeric < 1e12 ? numeric * 1000 : numeric) : undefined;
  if (typeof value !== 'string') return undefined;
  // A timezone offset is required; device-local interpretation is forbidden.
  if (!/(?:Z|[+-]\d\d:\d\d)$/i.test(value)) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
};

/** Preserve sparse field ownership, including explicit invalidation by null. */
export const readDailyChangeInput = (payload: unknown, mode?: DailyChangePriceMode): DailyChangeInput => {
  const quote = asRecord(payload) ?? {};
  const result: DailyChangeInput = {
    bid: toFiniteNumber(quote.bid),
    last: readFirstFiniteAlias(quote, LAST_PRICE_KEYS),
    mode: hasOwnAlias(quote, CHART_PRICE_MODE_KEYS) ? readDailyChangePriceMode(quote) ?? null : mode,
    provider: readText(quote, ['provider', 'quote_provider']),
    referenceProvider: readText(quote, ['reference_provider']),
    sessionId: readText(quote, ['session_id', 'trading_day']),
    referenceSessionId: readText(quote, ['reference_session_id']),
    sessionStart: readTime(quote.session_start),
    sessionEnd: readTime(quote.session_end),
    referenceMode: normalizeChartPriceMode(quote.reference_price_mode),
    referenceAsOf: readTime(quote.reference_as_of),
    adjustment: readText(quote, ['price_adjustment']),
    referenceAdjustment: readText(quote, ['reference_price_adjustment']),
  };
  const supplied = (keys: readonly string[]) => keys.some(key => Object.prototype.hasOwnProperty.call(quote, key) && quote[key] !== undefined);
  if (supplied(PREVIOUS_CLOSE_PRICE_KEYS)) result.previousClose = readFirstFiniteAlias(quote, PREVIOUS_CLOSE_PRICE_KEYS) ?? null;
  if (supplied(SETTLEMENT_PRICE_KEYS)) {
    // MT5 settlement must be nonzero. Zero means no settlement is applicable.
    result.settlement = readFirstFiniteAlias(quote, SETTLEMENT_PRICE_KEYS, value => value !== 0) ?? null;
  }
  if (supplied(DAILY_CHANGE_PERCENT_KEYS)) result.upstreamPercent = readDailyChangePercent(quote) ?? null;
  if (supplied(DAILY_CHANGE_PRICE_KEYS)) result.upstreamChange = readFirstFiniteAlias(quote, DAILY_CHANGE_PRICE_KEYS) ?? null;
  const convention = quote.negative_reference_convention;
  if (convention === 'signed' || convention === 'absolute') result.negativeConvention = convention;
  const status = quote.quote_status ?? quote.market_status;
  if (status === 'live' || status === 'delayed' || status === 'stale' || status === 'disconnected' || status === 'closed') result.status = status;
  return result;
};

/** Explicit TradingView adapter. `lp` is a trade price; rch/rchp are separate. */
export const readTradingViewDailyChangeInput = (payload: unknown): DailyChangeInput => {
  const quote = asRecord(payload) ?? {};
  return readDailyChangeInput({
    ...quote, chart_mode: 'last', last: quote.lp,
    daily_change_price: quote.ch, daily_change_pct: quote.chp,
    previous_close: quote.prev_close_price,
  });
};

export const toTradingViewDailyChangeValues = (values: DailyChangeValues, last?: number, previousClose?: number) => ({
  ch: values.change, chp: values.percent, lp: last, prev_close_price: previousClose,
});
