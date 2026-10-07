import {
  composeDailyChangeQuoteContext,
  readDailyChangeLastPrice,
  readDailyChangePercent,
  readDailyChangeInput,
  readDailyChangePreviousClose,
  resolveDailyChangePercent,
} from '../utils/dailyChange';
import {
  asUnknownRecord,
  readBrokerTimestampMs,
} from '../utils/brokerStreamSemantics';
import { readQuoteSessionRange, type QuoteSessionRange } from '../utils/quoteSessionRange';
import {
  readFirstFiniteNumber,
  readFirstNonEmptyString as readRecordNonEmptyString,
} from '../utils/recordFields';
import { resolveDailyChangePriceMode } from './dailyChangePriceModeRegistry';
import { hasExplicitQuoteSides, readQuoteFreshnessMetadata, type TerminalQuoteMetadata } from './terminalQuoteFreshness';
import { quoteDiagnosticsEnabled, rememberQuoteWireEvidence } from './quoteDiagnostics';

import { readQuoteTradingStatus, type QuoteTradingStatusFields } from '../utils/quoteTradingStatus';

export interface NormalizedQuoteTick extends QuoteSessionRange, TerminalQuoteMetadata, QuoteTradingStatusFields {
  dailyChangeInput?: import('../utils/dailyChange').DailyChangeInput;
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  timestamp: number;
  /** Feed-provided event time. Missing when `timestamp` is receipt-time fallback. */
  sourceTimestamp?: number;
  lp?: string;
  volume?: number;
  dailyChange?: number;
  high24h?: number;
  low24h?: number;
  high?: number;
  low?: number;
  open?: number;
  close?: number;
  last?: number;
}

const toNumber = (value: unknown, fallback = 0): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const readFirstNonEmptyString = (
  records: readonly Record<string, unknown>[],
  keys: readonly string[],
): string | undefined => {
  for (const record of records) {
    const normalized = readRecordNonEmptyString(record, keys);
    if (normalized !== undefined) return normalized;
  }
  return undefined;
};

const normalizeSymbol = (value: unknown): string => (
  typeof value === 'string' ? value.trim().toUpperCase() : ''
);

const readSourceTimestamp = (...records: Record<string, unknown>[]): number | undefined => (
  readBrokerTimestampMs(records.map(asUnknownRecord))
);

const QUOTE_PAYLOAD_KEYS = [
  'data',
  'tick',
  'quote',
  'price',
  'payload',
  'message',
  'prices',
  'ticks',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const isNonArrayRecord = (value: unknown): value is Record<string, unknown> => (
  isRecord(value) && !Array.isArray(value)
);

const getChannelSymbol = (value: unknown): string | undefined => {
  if (!isRecord(value) || typeof value.channel !== 'string') return undefined;
  // Everything after `ticks.` is the opaque broker symbol. Splitting on dots
  // truncates valid identities such as `0001.HK` and `EURUSD.r`.
  return value.channel.startsWith('ticks.')
    ? value.channel.slice('ticks.'.length)
    : undefined;
};

const hasQuoteIdentityFields = (value: unknown): boolean => (
  isRecord(value) && (normalizeSymbol(value.symbol) !== '' || getChannelSymbol(value) !== undefined)
);

const composeQuoteContext = (
  payload: unknown,
  envelopes: readonly unknown[],
): Record<string, unknown> => composeDailyChangeQuoteContext(
  payload,
  envelopes[0],
  envelopes.slice(1),
);

const resolveQuotePriceMode = (
  payload: unknown,
  symbol: unknown,
  envelopes: readonly unknown[],
) => resolveDailyChangePriceMode(payload, symbol, envelopes[0], envelopes.slice(1));

const findRoutingChannelSymbol = (
  payload: unknown,
  envelopes: readonly unknown[],
): string | undefined => {
  // The outer subscribed channel is the transport-routing authority. Walk from
  // outermost to nearest so a nested adapter wrapper cannot replace it.
  for (let index = envelopes.length - 1; index >= 0; index -= 1) {
    const channelSymbol = getChannelSymbol(envelopes[index]);
    if (channelSymbol !== undefined) return channelSymbol;
  }
  return getChannelSymbol(payload);
};

const findNearestEnvelopeSymbol = (envelopes: readonly unknown[]): unknown => {
  for (const envelope of envelopes) {
    if (isRecord(envelope) && normalizeSymbol(envelope.symbol)) return envelope.symbol;
  }
  return undefined;
};

const hasNestedQuotePayload = (value: Record<string, unknown>): boolean => (
  QUOTE_PAYLOAD_KEYS.some((key) => {
    const candidate = value[key];
    return Array.isArray(candidate)
      || isRecord(candidate)
      || (typeof candidate === 'string' && candidate.trim() !== '');
  })
);

const hasQuotePriceFields = (value: unknown, envelopes: readonly unknown[]): boolean => (
  isRecord(value) && (
    value.bid !== undefined
    || value.ask !== undefined
    || (
      readDailyChangeInput(composeQuoteContext(value, envelopes)).last !== undefined
      && (hasQuoteIdentityFields(value) || envelopes.some(hasQuoteIdentityFields))
    )
    || ((hasQuoteIdentityFields(value) || envelopes.some(hasQuoteIdentityFields))
      && ['daily_change_pct', 'daily_change', 'dailyChangePct', 'dailyChange', 'daily_change_price', 'dailyChangePrice', 'previous_close', 'previousClose', 'settlement_price', 'quote_status', 'market_status', 'session_id', 'trading_day'].some(key => key in value))
  )
);

interface CollectedQuotePayload {
  payload: Record<string, unknown>;
  /** Nearest wrapper first, followed by progressively outer wrappers. */
  envelopes: readonly Record<string, unknown>[];
}

const collectQuotePayloads = (
  raw: unknown,
  envelopes: readonly Record<string, unknown>[] = [],
): CollectedQuotePayload[] => {
  if (typeof raw === 'string') {
    try {
      return collectQuotePayloads(JSON.parse(raw), envelopes);
    } catch {
      return [];
    }
  }

  if (Array.isArray(raw)) {
    return raw.flatMap((item) => collectQuotePayloads(item, envelopes));
  }

  if (!isRecord(raw)) return [];

  const descendantEnvelopes = isNonArrayRecord(raw)
    ? [raw, ...envelopes]
    : envelopes;
  if (hasNestedQuotePayload(raw)) {
    const descendants = QUOTE_PAYLOAD_KEYS.flatMap((key) => {
      if (!(key in raw)) return [];
      const value = raw[key];

      if (Array.isArray(value)) {
        return value.flatMap((item) => collectQuotePayloads(item, descendantEnvelopes));
      }

      return collectQuotePayloads(value, descendantEnvelopes);
    });
    if (descendants.length > 0) return descendants;
  }

  return hasQuotePriceFields(raw, envelopes)
    ? [{ payload: raw, envelopes }]
    : [];
};

const normalizeQuotePayload = (
  payload: Record<string, unknown>,
  envelopes: readonly Record<string, unknown>[],
): NormalizedQuoteTick | null => {
  const channelSymbol = findRoutingChannelSymbol(payload, envelopes);
  // The subscribed channel is the routing authority. Some adapters expose an
  // unsuffixed payload symbol inside `ticks.EURUSD.r`.
  const symbol = normalizeSymbol(
    channelSymbol ?? payload.symbol ?? findNearestEnvelopeSymbol(envelopes),
  );
  if (!symbol) return null;

  const dailyChangeContext = composeQuoteContext(payload, envelopes);
  const last = readDailyChangeLastPrice(dailyChangeContext);
  const priceMode = resolveQuotePriceMode(payload, symbol, envelopes);
  const bid = toNumber(payload.bid);
  const ask = toNumber(payload.ask, bid);
  // Last-only exchange events are metadata, not executable Bid/Ask quotes.
  // Keep zero sides so the dispatcher routes them only to Market Watch's
  // isolated display-metadata channel.
  const dailyInput = readDailyChangeInput({ ...dailyChangeContext, bid: payload.bid }, priceMode);
  if (bid <= 0 && ask <= 0 && dailyInput.last === undefined
    && dailyInput.previousClose === undefined && dailyInput.settlement === undefined
    && dailyInput.upstreamChange === undefined && dailyInput.upstreamPercent === undefined
    && dailyInput.status === undefined && dailyInput.sessionId === undefined) return null;

  const previousClose = readDailyChangePreviousClose(dailyChangeContext);
  const dailyOpen = readFirstFiniteNumber(payload, [
    'daily_open',
    'dailyOpen',
    'open',
    'open_price',
    'openPrice',
  ]);
  const close = readFirstFiniteNumber(payload, ['close', 'close_price', 'closePrice'])
    ?? previousClose;
  const volume = readFirstFiniteNumber(payload, [
    'volume',
    'volume_24h',
    'volume24h',
    'tick_volume',
    'tickVolume',
    'real_volume',
    'realVolume',
  ]);

  const session = isRecord(payload.session) ? payload.session : {};
  const high = readFirstFiniteNumber(payload, ['high']);
  const low = readFirstFiniteNumber(payload, ['low']);
  const sessionHigh = Math.max(
    toNumber(session.high_bid),
    toNumber(session.high_ask),
    high ?? 0,
  );
  const sessionLowValues = [
    toNumber(session.low_bid),
    toNumber(session.low_ask),
    low ?? 0,
  ].filter((value) => value > 0);
  const sessionLow = sessionLowValues.length > 0 ? Math.min(...sessionLowValues) : undefined;
  const lp = readFirstNonEmptyString([payload, ...envelopes], [
    'lp',
    'provider',
    'liquidity_provider',
    'liquidityProvider',
    'lp_name',
    'lpName',
  ]);
  const sourceTimestamp = readSourceTimestamp(payload, ...envelopes);
  const freshnessMetadata = readQuoteFreshnessMetadata(payload, envelopes[0], envelopes.slice(1));
  if (!hasExplicitQuoteSides(payload)) freshnessMetadata.provider_timestamp = undefined;

  const normalized: NormalizedQuoteTick = {
    symbol,
    bid,
    ask,
    spread: toNumber(payload.spread, ask - bid),
    timestamp: sourceTimestamp ?? Date.now(),
    sourceTimestamp,
    ...freshnessMetadata,
    tradingStatus: readQuoteTradingStatus(payload),
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
    high24h: readFirstFiniteNumber(payload, ['high24h', 'high_24h'])
      ?? (sessionHigh || undefined),
    low24h: readFirstFiniteNumber(payload, ['low24h', 'low_24h']) ?? sessionLow,
    high,
    low,
    ...readQuoteSessionRange(payload),
    open: dailyOpen,
    close,
  };
  if (quoteDiagnosticsEnabled()) rememberQuoteWireEvidence(normalized, payload, envelopes, bid, ask);
  return normalized;
};

/** Convert a raw broker frame into validated, normalized quote ticks. */
export const processIncomingQuotePayload = (raw: unknown): NormalizedQuoteTick[] => (
  collectQuotePayloads(raw)
    .map(({ payload, envelopes }) => normalizeQuotePayload(payload, envelopes))
    .filter((tick): tick is NormalizedQuoteTick => tick !== null)
);
