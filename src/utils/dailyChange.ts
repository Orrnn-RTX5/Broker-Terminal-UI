const DAILY_CHANGE_PERCENT_KEYS = [
  'dailyChangePct',
  'daily_change_pct',
  'dailyChange',
  'daily_change',
] as const;

const LAST_PRICE_KEYS = ['last', 'last_price', 'lastPrice'] as const;

const PREVIOUS_CLOSE_PRICE_KEYS = ['previous_close', 'previousClose'] as const;

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
  LAST_PRICE_KEYS,
  SETTLEMENT_PRICE_KEYS,
  PREVIOUS_CLOSE_PRICE_KEYS,
  CHART_PRICE_MODE_KEYS,
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

  return ((currentPrice - baseline) / baseline) * 100;
};
