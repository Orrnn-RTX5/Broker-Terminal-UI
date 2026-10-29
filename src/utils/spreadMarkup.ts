/**
 * Account-group spread markup.
 *
 * The authenticated `/api/v2/instruments` catalogue carries `spread_markup`
 * (integer points >= 0) per symbol. The gateway executes, closes, triggers
 * SL/TP/pending orders and computes P&L at the widened ("effective") quote:
 *
 *   effective ask = raw ask + markup * tick_size
 *   effective bid = raw bid - markup * tick_size
 *
 * Quote feeds stay raw, so the terminal widens each account quote once, at the
 * live-tick funnel. An adjusted quote keeps its raw sides in `rawBid`/`rawAsk`
 * and its markup in `spreadMarkup`, which makes re-application idempotent and
 * lets raw-bid consumers (chart candles) opt out.
 */

export interface SpreadMarkupEntry {
  /** Markup in instrument points (ticks), > 0. */
  points: number;
  /** Price value of one point. */
  tickSize: number;
  /** Price digits used to round adjusted prices. */
  digits: number;
}

export type SpreadMarkupMap = ReadonlyMap<string, SpreadMarkupEntry>;

export const EMPTY_SPREAD_MARKUP_MAP: SpreadMarkupMap = new Map();

/** Fields a widened quote carries in addition to the effective bid/ask. */
export interface SpreadMarkupQuoteTag {
  rawBid?: number;
  rawAsk?: number;
  spreadMarkup?: number;
}

export interface SpreadMarkupInstrument {
  symbol: string;
  spreadMarkup?: number;
  tickSize?: number;
  digits?: number;
}

type QuoteLike = {
  bid?: unknown;
  ask?: unknown;
  spread?: unknown;
} & SpreadMarkupQuoteTag;

const MAX_DIGITS = 10;

const isPositiveFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export const normalizeSpreadMarkupSymbol = (symbol: unknown): string =>
  typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';

/** Parses a catalogue row's markup; anything but a finite value >= 0 is 0. */
export const readSpreadMarkupPoints = (raw: unknown): number | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  for (const key of ['spread_markup', 'spreadMarkup']) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const value = record[key];
    if (value === null || value === undefined || value === '') continue;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.round(parsed));
  }
  return undefined;
};

const countDecimals = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  for (let digits = 0; digits <= MAX_DIGITS; digits += 1) {
    const scaled = value * 10 ** digits;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9 * Math.max(1, scaled)) return digits;
  }
  return MAX_DIGITS;
};

const normalizeDigits = (digits: unknown): number | undefined => {
  const parsed = Number(digits);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.min(MAX_DIGITS, Math.floor(parsed));
};

export const roundPriceToDigits = (value: number, digits: number): number => {
  if (!Number.isFinite(value)) return value;
  const safeDigits = Math.min(MAX_DIGITS, Math.max(0, Math.floor(digits)));
  const factor = 10 ** safeDigits;
  const rounded = Math.round((value + Math.sign(value) * Number.EPSILON) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/**
 * Resolves one instrument's markup entry. Tick size comes from the instrument;
 * without one it is 10^-digits. Returns null when there is no usable markup.
 */
export const resolveSpreadMarkupEntry = (
  instrument: Omit<SpreadMarkupInstrument, 'symbol'>,
): SpreadMarkupEntry | null => {
  const points = Number(instrument.spreadMarkup);
  if (!Number.isFinite(points) || points <= 0) return null;

  const digits = normalizeDigits(instrument.digits);
  const tickSize = isPositiveFinite(instrument.tickSize)
    ? instrument.tickSize
    : digits !== undefined ? 10 ** -digits : null;
  if (tickSize === null) return null;

  return {
    points: Math.round(points),
    tickSize,
    digits: digits ?? countDecimals(tickSize),
  };
};

/** Per-symbol markup for the authenticated account catalogue. */
export const buildSpreadMarkupMap = (
  instruments: readonly SpreadMarkupInstrument[],
): SpreadMarkupMap => {
  const map = new Map<string, SpreadMarkupEntry>();
  instruments.forEach((instrument) => {
    const symbol = normalizeSpreadMarkupSymbol(instrument?.symbol);
    if (!symbol) return;
    const entry = resolveSpreadMarkupEntry(instrument);
    if (entry) map.set(symbol, entry);
  });
  return map.size > 0 ? map : EMPTY_SPREAD_MARKUP_MAP;
};

export const areSpreadMarkupMapsEqual = (left: SpreadMarkupMap, right: SpreadMarkupMap): boolean => {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [symbol, entry] of left) {
    const other = right.get(symbol);
    if (
      !other
      || other.points !== entry.points
      || other.tickSize !== entry.tickSize
      || other.digits !== entry.digits
    ) return false;
  }
  return true;
};

/** Price distance each side moves: markup points * tick size, digit-rounded. */
export const getSpreadMarkupOffset = (entry: SpreadMarkupEntry | null | undefined): number => {
  if (!entry || !(entry.points > 0) || !(entry.tickSize > 0)) return 0;
  return roundPriceToDigits(entry.points * entry.tickSize, entry.digits);
};

/** The raw (feed) bid/ask of a quote, whether or not it has been widened. */
export function getRawQuoteSides<T extends QuoteLike>(quote: T): T;
export function getRawQuoteSides<T extends QuoteLike>(quote: T | null | undefined): T | null | undefined;
export function getRawQuoteSides<T extends QuoteLike>(quote: T | null | undefined): T | null | undefined {
  if (!quote || typeof quote !== 'object') return quote;
  if (quote.rawBid === undefined && quote.rawAsk === undefined) return quote;
  return {
    ...quote,
    bid: quote.rawBid ?? quote.bid,
    ask: quote.rawAsk ?? quote.ask,
  };
}

/** How far the displayed bid sits below the raw bid (0 for a raw quote). */
export const getQuoteBidMarkupOffset = (quote: QuoteLike | null | undefined): number => {
  if (!quote) return 0;
  const bid = Number(quote.bid);
  const rawBid = Number(quote.rawBid);
  if (!Number.isFinite(bid) || !Number.isFinite(rawBid)) return 0;
  const offset = roundPriceToDigits(rawBid - bid, MAX_DIGITS);
  return offset > 0 ? offset : 0;
};

/** How far the displayed ask sits above the raw ask (0 for a raw quote). */
export const getQuoteAskMarkupOffset = (quote: QuoteLike | null | undefined): number => {
  if (!quote) return 0;
  const ask = Number(quote.ask);
  const rawAsk = Number(quote.rawAsk);
  if (!Number.isFinite(ask) || !Number.isFinite(rawAsk)) return 0;
  const offset = roundPriceToDigits(ask - rawAsk, MAX_DIGITS);
  return offset > 0 ? offset : 0;
};

const stripSpreadMarkupTag = <T extends QuoteLike>(quote: T): T => {
  const { rawBid, rawAsk, spreadMarkup: _spreadMarkup, ...rest } = quote;
  void _spreadMarkup;
  const bid = rawBid ?? (quote.bid as number);
  const ask = rawAsk ?? (quote.ask as number);
  const next = { ...rest, bid, ask } as T;
  if (isPositiveFinite(bid) && isPositiveFinite(ask)) {
    (next as QuoteLike).spread = Math.max(0, ask - bid);
  }
  return next;
};

/**
 * Widens a quote by the entry's markup. Always computed from the raw sides, so
 * applying it to an already widened quote (or with a changed markup) never
 * compounds. A missing/zero entry returns the raw quote.
 */
export const applySpreadMarkupToQuote = <T extends QuoteLike>(
  quote: T,
  entry: SpreadMarkupEntry | null | undefined,
): T & SpreadMarkupQuoteTag => {
  if (!quote || typeof quote !== 'object') return quote;
  const tagged = quote.rawBid !== undefined || quote.rawAsk !== undefined || quote.spreadMarkup !== undefined;
  const baseOffset = getSpreadMarkupOffset(entry);
  if (!entry || baseOffset <= 0) return tagged ? stripSpreadMarkupTag(quote) : quote;

  const rawBid = tagged && quote.rawBid !== undefined ? quote.rawBid : Number(quote.bid);
  const rawAsk = tagged && quote.rawAsk !== undefined ? quote.rawAsk : Number(quote.ask);
  const hasBid = isPositiveFinite(rawBid);
  const hasAsk = isPositiveFinite(rawAsk);
  if (!hasBid && !hasAsk) return tagged ? stripSpreadMarkupTag(quote) : quote;

  let effectiveDigits = entry.digits;
  let offset = baseOffset;
  if (entry.digits <= 2 && ((hasBid && rawBid < 1) || (hasAsk && rawAsk < 1))) {
    const observedDigits = Math.min(
      6,
      Math.max(
        hasBid ? countDecimals(rawBid) : 0,
        hasAsk ? countDecimals(rawAsk) : 0,
      ),
    );
    if (observedDigits > entry.digits) {
      effectiveDigits = observedDigits;
      const effectiveTickSize = 10 ** -effectiveDigits;
      offset = roundPriceToDigits(entry.points * effectiveTickSize, effectiveDigits);
    }
  }

  const bid = hasBid ? Math.max(0, roundPriceToDigits(rawBid - offset, effectiveDigits)) : quote.bid;
  const ask = hasAsk ? roundPriceToDigits(rawAsk + offset, effectiveDigits) : quote.ask;
  const next = {
    ...quote,
    bid,
    ask,
    rawBid: hasBid ? rawBid : undefined,
    rawAsk: hasAsk ? rawAsk : undefined,
    spreadMarkup: entry.points,
  } as T & SpreadMarkupQuoteTag;
  if (isPositiveFinite(bid) && isPositiveFinite(ask)) {
    (next as QuoteLike).spread = roundPriceToDigits(Math.max(0, (ask as number) - (bid as number)), effectiveDigits);
  }
  return next;
};

export const applySpreadMarkupFromMap = <T extends QuoteLike>(
  symbol: unknown,
  quote: T,
  map: SpreadMarkupMap,
): T => applySpreadMarkupToQuote(quote, map.get(normalizeSpreadMarkupSymbol(symbol)));

export interface PriceLevelLike {
  price: number;
}

/** Widens depth-of-market levels the same way as the top-of-book quote. */
export const applySpreadMarkupToBookLevels = <L extends PriceLevelLike>(
  levels: readonly L[],
  side: 'bid' | 'ask',
  entry: SpreadMarkupEntry | null | undefined,
): L[] => {
  const offset = getSpreadMarkupOffset(entry);
  if (!entry || offset <= 0) return levels as L[];
  const signedOffset = side === 'bid' ? -offset : offset;
  return levels.map((level) => ({
    ...level,
    price: roundPriceToDigits(level.price + signedOffset, entry.digits),
  }));
};

/**
 * Close price of an open position from the (already widened) account quote:
 * a BUY closes at bid, a SELL at ask; `last`/the other side are fallbacks.
 */
export const resolvePositionClosePrice = (
  side: unknown,
  quote: { bid?: unknown; ask?: unknown; last?: unknown } | null | undefined,
): number | null => {
  if (!quote) return null;
  const bid = Number(quote.bid);
  const ask = Number(quote.ask);
  const last = Number(quote.last);
  const isBuy = String(side ?? '').trim().toUpperCase() === 'BUY';
  const ordered = isBuy ? [bid, last, ask] : [ask, last, bid];
  const price = ordered.find(isPositiveFinite);
  return price ?? null;
};
