/**
 * Session Bid/Ask extremes published with a quote (MT5 SYMBOL_BIDHIGH,
 * SYMBOL_BIDLOW, SYMBOL_ASKHIGH, SYMBOL_ASKLOW). Values stay on the raw feed
 * basis; account spread markup is applied by the consumer that displays them.
 */
export interface QuoteSessionRange {
  bidHigh?: number;
  bidLow?: number;
  askHigh?: number;
  askLow?: number;
}

export const QUOTE_SESSION_RANGE_FIELDS = ['bidHigh', 'bidLow', 'askHigh', 'askLow'] as const;

const QUOTE_SESSION_RANGE_KEYS: Readonly<Record<keyof QuoteSessionRange, readonly string[]>> = {
  bidHigh: ['high_bid', 'highBid', 'bid_high', 'bidHigh', 'bidhigh'],
  bidLow: ['low_bid', 'lowBid', 'bid_low', 'bidLow', 'bidlow'],
  askHigh: ['high_ask', 'highAsk', 'ask_high', 'askHigh', 'askhigh'],
  askLow: ['low_ask', 'lowAsk', 'ask_low', 'askLow', 'asklow'],
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
);

const readPositive = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

/**
 * Reads the documented `session` object first, then flat adapter aliases.
 * Only positive broker values are kept: a missing side is never derived from
 * the other side or from the current quote. Absent fields are omitted so a
 * sparse frame leaves the previously published range in place.
 */
export const readQuoteSessionRange = (payload: unknown): QuoteSessionRange => {
  const record = asRecord(payload);
  if (!record) return {};
  const session = asRecord(record.session);
  const sources = session ? [session, record] : [record];
  const range: QuoteSessionRange = {};
  QUOTE_SESSION_RANGE_FIELDS.forEach((field) => {
    for (const source of sources) {
      for (const key of QUOTE_SESSION_RANGE_KEYS[field]) {
        const value = readPositive(source[key]);
        if (value === undefined) continue;
        range[field] = value;
        return;
      }
    }
  });
  return range;
};
