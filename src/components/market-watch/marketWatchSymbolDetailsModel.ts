import type { MarketWatchLastPrice } from '../../hooks/useLastMarketWatchQuotes';
import type { Tick } from '../../store/useAppStore';
import { formatDailyChange } from '../../utils/dailyChange';
import { getQuoteAskMarkupOffset, getQuoteBidMarkupOffset } from '../../utils/spreadMarkup';
import { hasMarketWatchQuote, readFiniteDailyChange } from './marketWatchPanelModel';

export interface MarketWatchSymbolSpecificationFields {
  tickSize: number | null;
  tickValue: number | null;
  digits: number | null;
}

/**
 * One MT5 Market Watch "Details" snapshot. Every value comes from the backend
 * for this exact symbol; null means the broker has not supplied it.
 */
export interface MarketWatchSymbolDetails {
  /** Broker price precision; null prints prices exactly as the backend sent them. */
  digits: number | null;
  tickSize: number | null;
  tickValue: number | null;
  bid: number | null;
  bidHigh: number | null;
  bidLow: number | null;
  ask: number | null;
  askHigh: number | null;
  askLow: number | null;
  dailyChange: number | null;
  open: number | null;
  close: number | null;
  /** Source time of a historical Bid/Ask fallback; null while quotes are live. */
  fallbackQuoteAsOf: number | null;
}

const SPECIFICATION_NESTED_KEYS = [
  'brokerSpecification',
  'specification',
  'spec',
  'contract',
  'trading_conditions',
  'tradingConditions',
] as const;
const TICK_SIZE_KEYS = ['tick_size', 'tickSize', 'trade_tick_size', 'tradeTickSize'] as const;
const POINT_KEYS = ['point_size', 'pointSize', 'point'] as const;
const TICK_VALUE_KEYS = ['tick_value', 'tickValue', 'trade_tick_value', 'tradeTickValue'] as const;
const MAX_PRICE_DIGITS = 10;

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const positiveNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const priceDigits = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_PRICE_DIGITS ? parsed : null;
};

/** Nested broker snapshots are authoritative over normalized wrapper fields. */
const collectSpecificationRecords = (source: unknown): Record<string, unknown>[] => {
  const root = asRecord(source);
  if (!root) return [];
  const nested = SPECIFICATION_NESTED_KEYS
    .map((key) => asRecord(root[key]))
    .filter((record): record is Record<string, unknown> => record !== null);
  return [...nested, root];
};

const readFirst = <T>(
  records: readonly Record<string, unknown>[],
  keys: readonly string[],
  parse: (value: unknown) => T | null,
): T | null => {
  for (const record of records) {
    for (const key of keys) {
      const parsed = parse(record[key]);
      if (parsed !== null) return parsed;
    }
  }
  return null;
};

/**
 * Reads Tick Size, Tick Value and Digits from instrument sources in priority
 * order. A true tick size from any source outranks a point size, because
 * contracts such as index futures tick in multiples of their point.
 */
export const readMarketWatchSymbolSpecification = (
  ...sources: readonly unknown[]
): MarketWatchSymbolSpecificationFields => {
  const records = sources.flatMap(collectSpecificationRecords);
  return {
    tickSize: readFirst(records, TICK_SIZE_KEYS, positiveNumber)
      ?? readFirst(records, POINT_KEYS, positiveNumber),
    tickValue: readFirst(records, TICK_VALUE_KEYS, positiveNumber),
    digits: readFirst(records, ['digits'], priceDigits),
  };
};

const shift = (value: number | null, offset: number): number | null => (
  value === null ? null : value + offset
);

// The session extreme can never sit inside the live quote it was measured on.
const includeHigh = (high: number | null, current: number | null): number | null => (
  high === null || current === null ? high : Math.max(high, current)
);

const includeLow = (low: number | null, current: number | null): number | null => (
  low === null || current === null ? low : Math.min(low, current)
);

interface BuildMarketWatchSymbolDetailsOptions {
  tick: Tick | undefined;
  lastPrice?: MarketWatchLastPrice;
  displayDailyChange?: number;
  closedDailyChange?: number | null;
  specification: MarketWatchSymbolSpecificationFields;
}

/**
 * Builds the Details view from the live AppStore tick. Session ranges arrive
 * on the raw feed basis, so they move by the same account markup as the
 * displayed Bid and Ask.
 */
export const buildMarketWatchSymbolDetails = ({
  tick,
  lastPrice,
  displayDailyChange,
  closedDailyChange,
  specification,
}: BuildMarketWatchSymbolDetailsOptions): MarketWatchSymbolDetails => {
  const hasLiveQuote = hasMarketWatchQuote(tick);
  const fallbackQuote = !hasLiveQuote && lastPrice?.kind === 'quote' ? lastPrice : undefined;
  const bid = positiveNumber(hasLiveQuote ? tick?.bid : fallbackQuote?.bid);
  const ask = positiveNumber(hasLiveQuote ? tick?.ask : fallbackQuote?.ask);
  const liveBid = hasLiveQuote ? bid : null;
  const liveAsk = hasLiveQuote ? ask : null;
  const bidOffset = hasLiveQuote ? getQuoteBidMarkupOffset(tick) : 0;
  const askOffset = hasLiveQuote ? getQuoteAskMarkupOffset(tick) : 0;
  // MT5 High/Low are Bid-based, so an explicit feed High stands in for Bid High.
  const rawBidHigh = positiveNumber(tick?.bidHigh) ?? positiveNumber(tick?.high);
  const rawBidLow = positiveNumber(tick?.bidLow) ?? positiveNumber(tick?.low);

  return {
    // Only the symbol specification carries broker digits. A tick's `digits`
    // can be a symbol-name guess filled in by a quote normalizer.
    digits: specification.digits,
    tickSize: specification.tickSize,
    tickValue: specification.tickValue,
    bid,
    bidHigh: includeHigh(shift(rawBidHigh, -bidOffset), liveBid),
    bidLow: includeLow(shift(rawBidLow, -bidOffset), liveBid),
    ask,
    askHigh: includeHigh(shift(positiveNumber(tick?.askHigh), askOffset), liveAsk),
    askLow: includeLow(shift(positiveNumber(tick?.askLow), askOffset), liveAsk),
    dailyChange: readFiniteDailyChange(displayDailyChange) ?? readFiniteDailyChange(closedDailyChange),
    open: positiveNumber(tick?.open),
    close: positiveNumber(tick?.close),
    fallbackQuoteAsOf: fallbackQuote?.asOf ?? null,
  };
};

const SPECIFICATION_NUMBER_FORMAT = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: MAX_PRICE_DIGITS,
  useGrouping: false,
});

/** Contract terms keep their exact broker precision, e.g. 0.00001 or 0.1. */
export const formatMarketWatchDetailsNumber = (value: number | null): string | null => (
  value === null ? null : SPECIFICATION_NUMBER_FORMAT.format(value)
);

export const formatMarketWatchDetailsPrice = (value: number | null, digits: number | null): string | null => (
  value === null ? null : digits === null ? formatMarketWatchDetailsNumber(value) : value.toFixed(digits)
);

export const formatMarketWatchDetailsPercent = (value: number | null): string | null => (
  value === null ? null : formatDailyChange(value, 2, true)
);
