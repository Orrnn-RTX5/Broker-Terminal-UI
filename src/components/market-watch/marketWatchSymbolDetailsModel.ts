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

const EXTENDED_SPECIFICATION_NESTED_KEYS = [
  ...SPECIFICATION_NESTED_KEYS,
  'costs',
  'metadata',
  'details',
  'session',
  'greeks',
  'options',
] as const;

const collectExtendedRecords = (source: unknown): Record<string, unknown>[] => {
  const root = asRecord(source);
  if (!root) return [];
  const nested = EXTENDED_SPECIFICATION_NESTED_KEYS
    .map((key) => asRecord(root[key]))
    .filter((record): record is Record<string, unknown> => record !== null);
  return [...nested, root];
};

const finiteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const nonNegativeNumber = (value: unknown): number | null => {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
};

export interface MarketWatchExtendedColumnResolution {
  numericValue: number | null;
  formatted: string | null;
  kind: 'price' | 'spec' | 'integer' | 'decimal';
}

export interface ResolveMarketWatchExtendedColumnOptions {
  column: string;
  tick: Tick | undefined;
  lastPrice?: MarketWatchLastPrice;
  displayLast?: unknown;
  instrumentSources?: readonly unknown[];
  /** Broker price digits resolved by the caller; null renders prices raw. */
  priceDigits?: number | null;
}

/**
 * Resolves any of the extended MT5 Market Watch columns (`tickSize` through
 * `sensitivity`) from the live tick and symbol specification records.
 */
export const resolveMarketWatchExtendedColumn = ({
  column,
  tick,
  lastPrice,
  displayLast,
  instrumentSources = [],
  priceDigits: fallbackDigits,
}: ResolveMarketWatchExtendedColumnOptions): MarketWatchExtendedColumnResolution => {
  const spec = readMarketWatchSymbolSpecification(...instrumentSources, tick);
  const details = buildMarketWatchSymbolDetails({
    tick,
    lastPrice,
    specification: spec,
  });
  // Broker spec digits only; unknown precision renders the raw value.
  const effectiveDigits = spec.digits ?? fallbackDigits ?? null;
  const allRecords = [tick, ...instrumentSources].flatMap(collectExtendedRecords);

  const asPrice = (val: number | null): MarketWatchExtendedColumnResolution => ({
    numericValue: val,
    formatted: val === null ? null : effectiveDigits === null ? String(val) : val.toFixed(effectiveDigits),
    kind: 'price',
  });

  const asSpec = (val: number | null): MarketWatchExtendedColumnResolution => ({
    numericValue: val,
    formatted: formatMarketWatchDetailsNumber(val),
    kind: 'spec',
  });

  const asInteger = (val: number | null): MarketWatchExtendedColumnResolution => ({
    numericValue: val,
    formatted: val === null ? null : Math.round(val).toLocaleString('en-US'),
    kind: 'integer',
  });

  const asDecimal = (val: number | null): MarketWatchExtendedColumnResolution => ({
    numericValue: val,
    formatted: formatMarketWatchDetailsNumber(val),
    kind: 'decimal',
  });

  switch (column) {
    case 'tickSize':
      return asSpec(spec.tickSize);
    case 'tickValue':
      return asSpec(spec.tickValue);
    case 'faceValue':
      return asSpec(readFirst(allRecords, ['face_value', 'faceValue', 'bond_face_value', 'bondFaceValue'], finiteNumber));
    case 'accruedInterest':
      return asSpec(readFirst(allRecords, ['accrued_interest', 'accruedInterest', 'bond_accrued_interest', 'bondAccruedInterest'], finiteNumber));
    case 'initialMargin':
      return asSpec(readFirst(allRecords, ['margin_initial', 'marginInitial', 'initial_margin', 'initialMargin'], finiteNumber));
    case 'maintenanceMargin':
      return asSpec(readFirst(allRecords, ['margin_maintenance', 'marginMaintenance', 'maintenance_margin', 'maintenanceMargin'], finiteNumber));
    case 'initialBuyMargin':
      return asSpec(
        readFirst(allRecords, [
          'initial_buy_margin',
          'initialBuyMargin',
          'margin_initial_buy',
          'marginInitialBuy',
          'buy_margin_initial',
          'buyMarginInitial',
          'margin_buy_initial',
          'marginBuyInitial',
          'margin_initial',
          'marginInitial',
          'initial_margin',
          'initialMargin',
        ], finiteNumber),
      );
    case 'initialSellMargin':
      return asSpec(
        readFirst(allRecords, [
          'initial_sell_margin',
          'initialSellMargin',
          'margin_initial_sell',
          'marginInitialSell',
          'sell_margin_initial',
          'sellMarginInitial',
          'margin_sell_initial',
          'marginSellInitial',
          'margin_initial',
          'marginInitial',
          'initial_margin',
          'initialMargin',
        ], finiteNumber),
      );
    case 'lowerLimit':
      return asPrice(readFirst(allRecords, [
        'price_limit_min',
        'priceLimitMin',
        'lower_limit',
        'lowerLimit',
        'limit_min',
        'limitMin',
        'session_price_limit_min',
        'sessionPriceLimitMin',
      ], positiveNumber));
    case 'upperLimit':
      return asPrice(readFirst(allRecords, [
        'price_limit_max',
        'priceLimitMax',
        'upper_limit',
        'upperLimit',
        'limit_max',
        'limitMax',
        'session_price_limit_max',
        'sessionPriceLimitMax',
      ], positiveNumber));
    case 'settlementPrice':
      return asPrice(readFirst(allRecords, [
        'settlement_price',
        'settlementPrice',
        'session_price_settlement',
        'sessionPriceSettlement',
        'price_settlement',
        'priceSettlement',
      ], positiveNumber));
    case 'bidHigh':
      return asPrice(details.bidHigh ?? positiveNumber(tick?.high24h));
    case 'bidLow':
      return asPrice(details.bidLow ?? positiveNumber(tick?.low24h));
    case 'askHigh':
      return asPrice(details.askHigh ?? readFirst(allRecords, ['askHigh', 'ask_high', 'high_ask', 'highAsk'], positiveNumber));
    case 'askLow':
      return asPrice(details.askLow ?? readFirst(allRecords, ['askLow', 'ask_low', 'low_ask', 'lowAsk'], positiveNumber));
    case 'lastHigh': {
      const rawLastHigh = readFirst(allRecords, ['lastHigh', 'last_high', 'high_last', 'highLast', 'lasthigh'], positiveNumber);
      const currentLast = positiveNumber(displayLast ?? tick?.last);
      return asPrice(includeHigh(rawLastHigh, currentLast));
    }
    case 'lastLow': {
      const rawLastLow = readFirst(allRecords, ['lastLow', 'last_low', 'low_last', 'lowLast', 'lastlow'], positiveNumber);
      const currentLast = positiveNumber(displayLast ?? tick?.last);
      return asPrice(includeLow(rawLastLow, currentLast));
    }
    case 'volumeHigh':
      return asInteger(readFirst(allRecords, ['volumeHigh', 'volume_high', 'high_volume', 'highVolume', 'volumehigh'], nonNegativeNumber));
    case 'volumeLow':
      return asInteger(readFirst(allRecords, ['volumeLow', 'volume_low', 'low_volume', 'lowVolume', 'volumelow'], nonNegativeNumber));
    case 'deals':
      return asInteger(readFirst(allRecords, ['deals', 'session_deals', 'sessionDeals'], nonNegativeNumber));
    case 'dealsVolume':
      return asInteger(readFirst(allRecords, ['dealsVolume', 'deals_volume', 'session_volume', 'sessionVolume', 'volume'], nonNegativeNumber));
    case 'turnover':
      return asSpec(readFirst(allRecords, ['turnover', 'session_turnover', 'sessionTurnover'], nonNegativeNumber));
    case 'openInterest':
      return asInteger(readFirst(allRecords, ['openInterest', 'open_interest', 'session_interest', 'sessionInterest'], nonNegativeNumber));
    case 'buyOrders':
      return asInteger(readFirst(allRecords, ['buyOrders', 'buy_orders', 'session_buy_orders', 'sessionBuyOrders'], nonNegativeNumber));
    case 'buyVolume':
      return asSpec(readFirst(allRecords, ['buyVolume', 'buy_volume', 'session_buy_orders_volume', 'sessionBuyOrdersVolume'], nonNegativeNumber));
    case 'sellOrders':
      return asInteger(readFirst(allRecords, ['sellOrders', 'sell_orders', 'session_sell_orders', 'sessionSellOrders'], nonNegativeNumber));
    case 'sellVolume':
      return asSpec(readFirst(allRecords, ['sellVolume', 'sell_volume', 'session_sell_orders_volume', 'sessionSellOrdersVolume'], nonNegativeNumber));
    case 'openPrice':
      return asPrice(details.open ?? readFirst(allRecords, ['open', 'openPrice', 'open_price', 'session_open', 'sessionOpen'], positiveNumber));
    case 'closePrice':
      return asPrice(
        details.close
          ?? (lastPrice?.kind === 'close' ? positiveNumber(lastPrice.close) : null)
          ?? readFirst(allRecords, ['close', 'closePrice', 'close_price', 'session_close', 'sessionClose', 'prevClose', 'prev_close'], positiveNumber),
      );
    case 'averageWeightedPrice':
      return asPrice(readFirst(allRecords, ['averageWeightedPrice', 'average_weighted_price', 'awp', 'session_aw', 'sessionAw', 'vwap'], positiveNumber));
    case 'volatility':
      return asDecimal(readFirst(allRecords, ['volatility', 'price_volatility', 'priceVolatility', 'option_volatility'], finiteNumber));
    case 'theoreticalPrice':
      return asPrice(readFirst(allRecords, ['theoreticalPrice', 'theoretical_price', 'price_theoretical', 'priceTheoretical'], positiveNumber));
    case 'delta':
      return asDecimal(readFirst(allRecords, ['delta', 'price_delta', 'priceDelta', 'greek_delta'], finiteNumber));
    case 'theta':
      return asDecimal(readFirst(allRecords, ['theta', 'price_theta', 'priceTheta', 'greek_theta'], finiteNumber));
    case 'gamma':
      return asDecimal(readFirst(allRecords, ['gamma', 'price_gamma', 'priceGamma', 'greek_gamma'], finiteNumber));
    case 'vega':
      return asDecimal(readFirst(allRecords, ['vega', 'price_vega', 'priceVega', 'greek_vega'], finiteNumber));
    case 'rho':
      return asDecimal(readFirst(allRecords, ['rho', 'price_rho', 'priceRho', 'greek_rho'], finiteNumber));
    case 'omega':
      return asDecimal(readFirst(allRecords, ['omega', 'price_omega', 'priceOmega', 'greek_omega'], finiteNumber));
    case 'sensitivity':
      return asDecimal(readFirst(allRecords, ['sensitivity', 'price_sensitivity', 'priceSensitivity'], finiteNumber));
    default:
      return { numericValue: null, formatted: null, kind: 'spec' };
  }
};
