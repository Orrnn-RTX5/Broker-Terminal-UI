import {
  composeDailyChangeQuoteContext,
  readDailyChangeLastPrice,
  readDailyChangePercent,
  readDailyChangePreviousClose,
  resolveDailyChangePercent,
} from '../../../utils/dailyChange';
import { resolveDailyChangePriceMode } from '../../../services/dailyChangePriceModeRegistry';
import { asUnknownRecord, readBrokerTimestampMs } from '../../../utils/brokerStreamSemantics';
import { readQuoteSessionRange, type QuoteSessionRange } from '../../../utils/quoteSessionRange';
import { readFirstFiniteNumber } from '../../../utils/recordFields';

export interface NormalizedRealtimeTick extends QuoteSessionRange {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  timestamp: number;
  sourceTimestamp?: number;
  prevBid?: number;
  lp?: string;
  dailyChange?: number;
  high24h?: number;
  low24h?: number;
  volume?: number;
  last?: number;
  digits?: number;
  open?: number;
  close?: number;
}

export const WS_DEBUG = false;

type TickPayloadRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is TickPayloadRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const toNumber = (value: unknown, fallback = 0): number => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.amount !== undefined && record.amount !== null) {
      return toNumber(record.amount, fallback);
    }
  }
  const cleanString = String(value).replace(/,/g, '');
  const number = Number(cleanString);
  return Number.isFinite(number) ? number : fallback;
};

const getDefaultSpread = (symbol: string): number => {
  if (symbol.includes('JPY')) return 0.01;
  if (symbol.includes('XAU') || symbol.includes('XAG') || symbol.includes('XPT') || symbol.includes('XPD')) return 0.5;
  if (symbol.includes('BTC')) return 50;
  if (symbol.includes('ETH')) return 5;
  if (symbol.includes('LTC') || symbol.includes('SOL') || symbol.includes('XRP')) return 0.5;
  return 0.0001;
};

const getSymbolDigits = (symbol: string): number => {
  if (symbol.includes('JPY')) return 3;
  if (symbol.includes('BTC') || symbol.includes('ETH')) return 2;
  if (symbol.includes('LTC') || symbol.includes('SOL') || symbol.includes('XRP') || symbol.includes('BNB') || symbol.includes('DOT') || symbol.includes('ADA')) return 4;
  if (symbol.includes('XAU') || symbol.includes('XAG') || symbol.includes('XPT') || symbol.includes('XPD')) return 2;
  if (symbol.includes('NAS') || symbol.includes('SPX') || symbol.includes('DJ') || symbol.includes('US30') || symbol.includes('US500') || symbol.includes('NDX')) return 2;
  return 5;
};

export const normalizeRealtimeTick = (
  raw: unknown,
  previous?: NormalizedRealtimeTick,
  envelope?: unknown,
  ancestorEnvelopes: readonly unknown[] = [],
): NormalizedRealtimeTick | null => {
  const record = isRecord(raw) ? raw : {};
  const candle = isRecord(record.candle) ? record.candle : undefined;
  const rawSymbol = typeof record.symbol === 'string' ? record.symbol : '';
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) {
    if (WS_DEBUG) console.log('[normalizeTick] No symbol in raw data:', raw);
    return null;
  }

  const parsedBid = toNumber(record.bid, Number.NaN);
  const parsedAsk = toNumber(record.ask, Number.NaN);
  const dailyChangeContext = composeDailyChangeQuoteContext(raw, envelope, ancestorEnvelopes);
  const brokerLast = readDailyChangeLastPrice(dailyChangeContext);
  const priceMode = resolveDailyChangePriceMode(raw, symbol, envelope, ancestorEnvelopes);
  const explicitLastMode = priceMode === 'last';
  // `price` and candle close remain supported legacy midpoint envelopes. A
  // standalone Last field is different: use it only when the broker explicitly
  // declares Last chart mode, because Bid-mode ticks may include supplemental
  // Last metadata.
  const parsedMid = explicitLastMode && brokerLast !== undefined
    ? brokerLast
    : Number(record.price ?? candle?.close);
  let bid = parsedBid;
  let ask = parsedAsk;

  if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
    if (!Number.isFinite(parsedMid)) return null;
    if (explicitLastMode && brokerLast !== undefined) {
      // Preserve only real quote sides. Last is display/session metadata and
      // must never become an executable Bid or Ask.
      bid = Number.isFinite(bid) && bid > 0 ? bid : 0;
      ask = Number.isFinite(ask) && ask > 0 ? ask : 0;
    } else {
      const rawSpread = Number(record.spread);
      const previousSpread = previous?.spread;
      const spreadForSynthesis = Number.isFinite(rawSpread) && rawSpread >= 0
        ? rawSpread
        : (Number.isFinite(previousSpread) && previousSpread! >= 0
          ? previousSpread!
          : getDefaultSpread(symbol));
      bid = parsedMid - spreadForSynthesis / 2;
      ask = parsedMid + spreadForSynthesis / 2;
    }
  }

  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return null;
  if (ask < bid) [bid, ask] = [ask, bid];

  const computedSpread = ask - bid;
  const spread = Number.isFinite(Number(record.spread)) && Number(record.spread) >= 0
    ? Number(record.spread)
    : Math.max(0, computedSpread);
  const previousClose = readDailyChangePreviousClose(dailyChangeContext);
  const sourceTimestamp = readBrokerTimestampMs([
    asUnknownRecord(record),
    asUnknownRecord(envelope),
    ...ancestorEnvelopes.map(asUnknownRecord),
  ]) ?? readBrokerTimestampMs([asUnknownRecord(candle)], ['time']);

  return {
    symbol,
    bid,
    ask,
    spread,
    timestamp: sourceTimestamp ?? Date.now(),
    sourceTimestamp,
    lp: typeof record.lp === 'string' && record.lp.trim() ? record.lp : 'YOFX',
    dailyChange: resolveDailyChangePercent(
      readDailyChangePercent(dailyChangeContext),
      bid,
      previousClose,
      dailyChangeContext,
      priceMode,
    ),
    high24h: toNumber(record.high_24h ?? record.high24h, previous?.high24h ?? Math.max(bid, ask)),
    low24h: toNumber(record.low_24h ?? record.low24h, previous?.low24h ?? Math.min(bid, ask)),
    volume: toNumber(record.volume_24h ?? record.volume ?? candle?.volume, previous?.volume ?? 0),
    // Last is an exchange field, not the Bid/Ask midpoint. Leave it absent
    // when the broker did not publish one.
    last: brokerLast,
    digits: toNumber(record.digits, previous?.digits ?? 0) || getSymbolDigits(symbol),
    ...readQuoteSessionRange(record),
    open: readFirstFiniteNumber(record, ['daily_open', 'dailyOpen', 'open', 'open_price', 'openPrice']),
    close: readFirstFiniteNumber(record, ['close', 'close_price', 'closePrice']) ?? previousClose,
  };
};

export interface ParsedTickPayloadContext {
  payload: TickPayloadRecord;
  /** Nearest wrapper first, followed by progressively outer wrappers. */
  envelopes: readonly TickPayloadRecord[];
}

const NESTED_TICK_PAYLOAD_KEYS = [
  'data', 'tick', 'quote', 'price', 'payload', 'message', 'prices', 'ticks',
] as const;

const hasDirectBidAskOrMid = (record: TickPayloadRecord): boolean => (
  record.bid !== undefined
  || record.ask !== undefined
  || (record.price !== undefined && !isRecord(record.price))
  || isRecord(record.candle)
);

const hasDirectLast = (record: TickPayloadRecord): boolean => (
  record.last !== undefined
  || record.last_price !== undefined
  || record.lastPrice !== undefined
);

export const parseTickPayloadContexts = (
  input: unknown,
  envelopes: readonly TickPayloadRecord[] = [],
): ParsedTickPayloadContext[] => {
  if (!input) return [];
  if (typeof input === 'string') {
    try {
      return parseTickPayloadContexts(JSON.parse(input), envelopes);
    } catch {
      return [];
    }
  }
  if (Array.isArray(input)) {
    return input.flatMap((item) => parseTickPayloadContexts(item, envelopes));
  }
  if (isRecord(input)) {
    for (const key of NESTED_TICK_PAYLOAD_KEYS) {
      const candidate = input[key];
      const isContainer = Array.isArray(candidate)
        || isRecord(candidate)
        || (typeof candidate === 'string' && key !== 'price');
      if (!isContainer) continue;
      const nested = parseTickPayloadContexts(candidate, [input, ...envelopes]).filter(({ payload }) => (
        hasDirectBidAskOrMid(payload) || hasDirectLast(payload)
      ));
      if (nested.length > 0) return nested;
    }

    if (hasDirectBidAskOrMid(input)) return [{ payload: input, envelopes }];
    if (hasDirectLast(input)) return [{ payload: input, envelopes }];
    if (typeof input.symbol === 'string') return [{ payload: input, envelopes }];
  }
  return [];
};

export const parseTickPayloads = (input: unknown): TickPayloadRecord[] => (
  parseTickPayloadContexts(input).map(({ payload }) => payload)
);
